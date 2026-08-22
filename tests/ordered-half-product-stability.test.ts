import { describe, expect, it } from "vitest";
import {
  accumulateData,
  accumulateDataChunked,
  createAccumulationStream
} from "../src/index.js";
import type { AccumulateOptions, ENAData, Row } from "../src/index.js";

const codes = ["A", "B"];

function optionsFor(rows: Row[], networkType: "ordered" | "standard"): AccumulateOptions {
  return {
    rows,
    units: ["unit"],
    conversation: ["horizon"],
    codes,
    networkType,
    weightBy: "sum"
  };
}

function edgeValue(data: ENAData, ground: string, response: string): number {
  const edge = data.adjacencyKey.find(
    (candidate) => candidate.source === ground && candidate.target === response
  );
  if (!edge) throw new Error(`Missing edge ${ground} -> ${response}.`);
  return Number(data.connectionCounts[0]?.[edge.name] ?? 0);
}

const accumulationModes: Array<{
  name: string;
  run: (options: AccumulateOptions) => ENAData;
}> = [
  {
    name: "batch",
    run: (options) => accumulateData(options)
  },
  {
    name: "chunked",
    run: (options) => accumulateDataChunked({ ...options, chunkSize: 1 })
  },
  {
    name: "stream",
    run: (options) => {
      const { rows, ...streamOptions } = options;
      const stream = createAccumulationStream(streamOptions);
      for (const row of rows) stream.push([row]);
      return stream.finish();
    }
  }
];

describe.each(accumulationModes)("ordered half-product stability through $name accumulation", ({ run }) => {
  it("keeps a representable MIN_VALUE half-product equal in both directions", () => {
    const data = run(optionsFor([
      { unit: "u1", horizon: "h1", A: Number.MIN_VALUE, B: 2 }
    ], "ordered"));

    const aToB = edgeValue(data, "A", "B");
    const bToA = edgeValue(data, "B", "A");
    expect(aToB).toBe(Number.MIN_VALUE);
    expect(bToA).toBe(Number.MIN_VALUE);
    expect(aToB).toBe(bToA);
  });

  it("continues to reject a true same-row half-product underflow", () => {
    expect(() => run(optionsFor([
      { unit: "u1", horizon: "h1", A: Number.MIN_VALUE, B: 1 }
    ], "ordered"))).toThrowError(
      /Ordered network analysis numeric underflow .* positive same-row operands .* produced 0\./
    );
  });

  it("continues to reject a true same-row half-product overflow", () => {
    expect(() => run(optionsFor([
      { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 4 }
    ], "ordered"))).toThrowError(
      /Ordered network analysis derived a non-finite connection .* got Infinity\./
    );
  });

  it("leaves the standard ENA product unhalved", () => {
    const data = run(optionsFor([
      { unit: "u1", horizon: "h1", A: Number.MIN_VALUE, B: 2 }
    ], "standard"));

    expect(data.connectionMatrix).toEqual([[Number.MIN_VALUE * 2]]);
  });
});
