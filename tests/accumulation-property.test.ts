import { describe, expect, it } from "vitest";
import { accumulateData, createAccumulationStream, refWindowMatrix, vectorToUpperTriangle, sumColumns } from "../src/index.js";
import type { Matrix, Row } from "../src/index.js";

// Randomized property suite for the consolidated accumulation engine
// (advisory F-007 acceptance): >=100 seeded random configurations across all
// models x windows x weights, asserting (1) pushing rows ONE AT A TIME
// through the stream reproduces the one-shot result exactly, and (2) the
// engine's per-row co-occurrences match an independent oracle built from the
// golden-verified refWindowMatrix kernel applied per conversation.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RandomConfig = {
  rows: Row[];
  codes: string[];
  model: "EndPoint" | "AccumulatedTrajectory" | "SeparateTrajectory";
  window: "MovingStanzaWindow" | "Conversation";
  weightBy: "binary" | "sum";
  windowSizeBack: number;
  windowSizeForward: number;
  mask?: Matrix;
};

function randomConfig(random: () => number, index: number): RandomConfig {
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;
  const codeCount = 2 + Math.floor(random() * 4); // 2..5 codes
  const codes = Array.from({ length: codeCount }, (_unused, i) => `K${i}`);
  const unitCount = 2 + Math.floor(random() * 3);
  const convCount = 1 + Math.floor(random() * 3);
  const rowCount = 6 + Math.floor(random() * 30);
  const rows: Row[] = Array.from({ length: rowCount }, (_u, r) => ({
    unit: `u${Math.floor(random() * unitCount)}`,
    conv: `c${Math.floor(random() * convCount)}`,
    grp: r % 2 === 0 ? "G1" : "G2",
    ...Object.fromEntries(codes.map((code) => [code, random() < 0.45 ? (random() < 0.25 ? 2 : 1) : 0]))
  }));
  const config: RandomConfig = {
    rows,
    codes,
    model: pick(["EndPoint", "AccumulatedTrajectory", "SeparateTrajectory"]),
    window: pick(["MovingStanzaWindow", "Conversation"]),
    weightBy: pick(["binary", "sum"]),
    windowSizeBack: pick([0, 1, 2, 4, Number.POSITIVE_INFINITY]),
    windowSizeForward: pick([0, 0, 1, 3])
  };
  if (index % 4 === 0) {
    // Occasionally exercise a mask (symmetric 0/1 with the diagonal free).
    config.mask = codes.map((_a, i) => codes.map((_b, j) => (i === j ? 1 : (i + j) % 2)));
  }
  return config;
}

function options(config: RandomConfig) {
  return {
    rows: config.rows,
    units: ["unit"],
    conversation: ["conv"],
    codes: config.codes,
    metadata: ["grp"],
    model: config.model,
    window: config.window,
    weightBy: config.weightBy,
    windowSizeBack: config.windowSizeBack,
    windowSizeForward: config.windowSizeForward,
    ...(config.mask ? { mask: config.mask } : {})
  };
}

// Independent oracle aligned with the engine's rowConnectionCounts shape:
// moving windows produce one row per input row (golden-verified
// refWindowMatrix kernel applied per conversation); Conversation windows
// produce one row per (conversation, unit) group in first-appearance order,
// each summing the group's code vectors. Masks multiply the upper-triangle
// cells.
function oracleRowCoOccurrences(config: RandomConfig): number[][] {
  const binary = config.weightBy === "binary";
  let out: number[][];
  if (config.window === "Conversation") {
    const groups = new Map<string, number[]>();
    config.rows.forEach((row, index) => {
      const key = `${String(row.conv)}::${String(row.unit)}`;
      const list = groups.get(key) ?? [];
      list.push(index);
      groups.set(key, list);
    });
    out = [...groups.values()].map((indices) => {
      const codeMatrix = indices.map((index) => config.codes.map((code) => Number(config.rows[index]?.[code] ?? 0)));
      return vectorToUpperTriangle(sumColumns(codeMatrix)).map((value) => (binary ? (value > 0 ? 1 : 0) : value));
    });
  } else {
    const byConv = new Map<string, number[]>();
    config.rows.forEach((row, index) => {
      const key = String(row.conv);
      const list = byConv.get(key) ?? [];
      list.push(index);
      byConv.set(key, list);
    });
    out = Array.from({ length: config.rows.length }, () => []);
    for (const indices of byConv.values()) {
      const codeMatrix = indices.map((index) => config.codes.map((code) => Number(config.rows[index]?.[code] ?? 0)));
      const co = refWindowMatrix(codeMatrix, config.windowSizeBack, config.windowSizeForward, binary);
      indices.forEach((rowIndex, local) => {
        out[rowIndex] = co[local] ?? [];
      });
    }
  }
  if (config.mask) {
    const flat: number[] = [];
    for (let target = 1; target < config.codes.length; target += 1) {
      for (let source = 0; source < target; source += 1) flat.push(config.mask[source]?.[target] ?? 1);
    }
    return out.map((row) => row.map((value, index) => value * (flat[index] ?? 1)));
  }
  return out;
}

describe("consolidated accumulation engine properties (F-007)", () => {
  const random = mulberry32(20260711);
  const CASES = 120;

  it(`one-shot === row-by-row streaming and matches the window oracle across ${CASES} random configs`, () => {
    for (let index = 0; index < CASES; index += 1) {
      const config = randomConfig(random, index);
      const opts = options(config);
      const oneShot = accumulateData(opts);

      // Row-by-row streaming reproduces the one-shot result exactly.
      const stream = createAccumulationStream({ ...opts, rows: [] });
      for (const row of config.rows) stream.push([row]);
      const streamed = stream.finish();
      expect(streamed, `config ${index} (${config.model}/${config.window}/b${config.windowSizeBack}/f${config.windowSizeForward}/${config.weightBy})`).toEqual(oneShot);

      // Per-row co-occurrences match the independent refWindowMatrix oracle.
      const expected = oracleRowCoOccurrences(config);
      const adjacencyColumns = oneShot.codeColumns;
      oneShot.rowConnectionCounts.forEach((row, rowIndex) => {
        adjacencyColumns.forEach((column, columnIndex) => {
          const actual = Number(row[column] ?? 0);
          const oracle = expected[rowIndex]?.[columnIndex] ?? 0;
          expect(actual, `config ${index} row ${rowIndex} ${column}`).toBeCloseTo(oracle, 12);
        });
      });
    }
  });
});
