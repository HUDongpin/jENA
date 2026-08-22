import { describe, expect, it } from "vitest";
import {
  accumulateData,
  accumulateDataChunked,
  createAccumulationStream,
  ena
} from "../src/index.js";
import type { AccumulateOptions, ENAData, Row } from "../src/index.js";

const codes = ["A", "B"];

function orderedOptions(rows: Row[], overrides: Partial<AccumulateOptions> = {}): AccumulateOptions {
  return {
    rows,
    units: ["unit"],
    conversation: ["horizon"],
    codes,
    networkType: "ordered",
    ...overrides
  };
}

function edgeColumn(data: ENAData, ground: string, response: string): string {
  const entry = data.adjacencyKey.find((candidate) => candidate.source === ground && candidate.target === response);
  if (!entry) throw new Error(`Missing ordered edge ${ground} -> ${response}.`);
  return entry.name;
}

function edgeValue(row: Row, data: ENAData, ground: string, response: string): number {
  return Number(row[edgeColumn(data, ground, response)] ?? 0);
}

describe("ordered network accumulation", () => {
  it("uses a full column-major ground-to-response adjacency including self loops", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 1, C: 1 }
    ], { codes: ["A", "B", "C"] }));

    expect(data.networkType).toBe("ordered");
    expect(data.functionParams.networkType).toBe("ordered");
    expect(data.functionParams.weightBy).toBe("sum");
    expect(data.codeColumns).toEqual([
      "A & A", "B & A", "C & A",
      "A & B", "B & B", "C & B",
      "A & C", "B & C", "C & C"
    ]);
    expect(data.adjacencyKey).toEqual([
      { source: "A", target: "A", name: "A & A", sourceIndex: 0, targetIndex: 0 },
      { source: "B", target: "A", name: "B & A", sourceIndex: 1, targetIndex: 0 },
      { source: "C", target: "A", name: "C & A", sourceIndex: 2, targetIndex: 0 },
      { source: "A", target: "B", name: "A & B", sourceIndex: 0, targetIndex: 1 },
      { source: "B", target: "B", name: "B & B", sourceIndex: 1, targetIndex: 1 },
      { source: "C", target: "B", name: "C & B", sourceIndex: 2, targetIndex: 1 },
      { source: "A", target: "C", name: "A & C", sourceIndex: 0, targetIndex: 2 },
      { source: "B", target: "C", name: "B & C", sourceIndex: 1, targetIndex: 2 },
      { source: "C", target: "C", name: "C & C", sourceIndex: 2, targetIndex: 2 }
    ]);
    expect(data.connectionMatrix).toEqual([[
      0, 0.5, 0.5,
      0.5, 0, 0.5,
      0.5, 0.5, 0
    ]]);
  });

  it("splits same-row A+B equally in both directions without diagonal mass", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 1 }
    ]));
    const row = data.rowConnectionCounts[0]!;

    expect(edgeValue(row, data, "A", "B")).toBe(0.5);
    expect(edgeValue(row, data, "B", "A")).toBe(0.5);
    expect(edgeValue(row, data, "A", "A")).toBe(0);
    expect(edgeValue(row, data, "B", "B")).toBe(0);
  });

  it("orients a prior A followed by response B as A to B only", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 1 }
    ], { windowSizeBack: 2 }));
    const responseRow = data.rowConnectionCounts[1]!;

    expect(edgeValue(responseRow, data, "A", "B")).toBe(1);
    expect(edgeValue(responseRow, data, "B", "A")).toBe(0);
  });

  it("preserves a cross-row repeated code as a self loop", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 0 },
      { unit: "u1", horizon: "h1", A: 1, B: 0 }
    ], { windowSizeBack: 2 }));

    expect(edgeValue(data.rowConnectionCounts[1]!, data, "A", "A")).toBe(1);
  });

  it("treats windowSizeBack as total stanza rows: current plus at most N-1 prior rows", () => {
    const rows: Row[] = [
      { unit: "u1", horizon: "h1", A: 1, B: 0, C: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 1, C: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 0, C: 1 }
    ];
    const options = { codes: ["A", "B", "C"] };
    const one = accumulateData(orderedOptions(rows, { ...options, windowSizeBack: 1 }));
    const two = accumulateData(orderedOptions(rows, { ...options, windowSizeBack: 2 }));
    const three = accumulateData(orderedOptions(rows, { ...options, windowSizeBack: 3 }));
    const infinite = accumulateData(orderedOptions(rows, { ...options, windowSizeBack: Number.POSITIVE_INFINITY }));

    expect(one.connectionMatrix[0]).toEqual(Array.from({ length: 9 }, () => 0));
    expect(edgeValue(two.connectionCounts[0]!, two, "A", "C")).toBe(0);
    expect(edgeValue(two.connectionCounts[0]!, two, "B", "C")).toBe(1);
    expect(edgeValue(three.connectionCounts[0]!, three, "A", "C")).toBe(1);
    expect(edgeValue(three.connectionCounts[0]!, three, "B", "C")).toBe(1);
    expect(infinite.connectionMatrix).toEqual(three.connectionMatrix);
  });

  it("resets all prior context at a horizon boundary", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 0 },
      { unit: "u1", horizon: "h2", A: 0, B: 1 }
    ], { windowSizeBack: Number.POSITIVE_INFINITY }));

    expect(edgeValue(data.rowConnectionCounts[1]!, data, "A", "B")).toBe(0);
    expect(edgeValue(data.connectionCounts[0]!, data, "A", "B")).toBe(0);
  });

  it("attributes a response-row contribution to its analytic unit across a shared horizon", () => {
    const data = accumulateData(orderedOptions([
      { unit: "ground-unit", horizon: "shared", A: 1, B: 0 },
      { unit: "response-unit", horizon: "shared", A: 0, B: 1 }
    ], { windowSizeBack: 2 }));
    const groundUnit = data.connectionCounts.find((row) => row.ENA_UNIT === "ground-unit")!;
    const responseUnit = data.connectionCounts.find((row) => row.ENA_UNIT === "response-unit")!;

    expect(edgeValue(groundUnit, data, "A", "B")).toBe(0);
    expect(edgeValue(responseUnit, data, "A", "B")).toBe(1);
  });

  it("applies the full directional p-squared mask, including diagonal cells", () => {
    const rows: Row[] = [
      { unit: "direction", horizon: "h1", A: 1, B: 0 },
      { unit: "direction", horizon: "h1", A: 0, B: 1 },
      { unit: "self", horizon: "h2", A: 1, B: 0 },
      { unit: "self", horizon: "h2", A: 1, B: 0 }
    ];
    // Matrix rows are ground/source and columns are response/target.
    const allowed = accumulateData(orderedOptions(rows, {
      windowSizeBack: 2,
      mask: [[1, 1], [0, 1]]
    }));
    const direction = allowed.connectionCounts.find((row) => row.ENA_UNIT === "direction")!;
    const self = allowed.connectionCounts.find((row) => row.ENA_UNIT === "self")!;

    expect(edgeValue(direction, allowed, "A", "B")).toBe(1);
    expect(edgeValue(direction, allowed, "B", "A")).toBe(0);
    expect(edgeValue(self, allowed, "A", "A")).toBe(1);

    const diagonalBlocked = accumulateData(orderedOptions(rows, {
      windowSizeBack: 2,
      mask: [[0, 1], [0, 1]]
    }));
    const blockedSelf = diagonalBlocked.connectionCounts.find((row) => row.ENA_UNIT === "self")!;
    expect(edgeValue(blockedSelf, diagonalBlocked, "A", "A")).toBe(0);
  });

  it("keeps raw repeated-code counts instead of silently binarizing", () => {
    const crossRow = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 2, B: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 3 }
    ], { windowSizeBack: 2 }));
    expect(edgeValue(crossRow.rowConnectionCounts[1]!, crossRow, "A", "B")).toBe(6);

    const sameRow = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 2, B: 3 }
    ]));
    expect(edgeValue(sameRow.rowConnectionCounts[0]!, sameRow, "A", "B")).toBe(3);
    expect(edgeValue(sameRow.rowConnectionCounts[0]!, sameRow, "B", "A")).toBe(3);
  });

  it("records the actual prior global row indices used for each ordered response", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 0 },
      { unit: "u2", horizon: "h2", A: 0, B: 1 },
      { unit: "u2", horizon: "h1", A: 0, B: 1 },
      { unit: "u1", horizon: "h1", A: 1, B: 0 }
    ], { windowSizeBack: 2 }));

    expect(data.rowWindowProvenance).toEqual([
      { responseRowIndex: 0, horizon: "h1", priorRowIndices: [] },
      { responseRowIndex: 1, horizon: "h2", priorRowIndices: [] },
      { responseRowIndex: 2, horizon: "h1", priorRowIndices: [0] },
      { responseRowIndex: 3, horizon: "h1", priorRowIndices: [2] }
    ]);
  });
});

describe("ordered network validation", () => {
  const rows: Row[] = [{ unit: "u1", horizon: "h1", A: 1, B: 1 }];

  it("rejects forward windows instead of ignoring them", () => {
    expect(() => accumulateData(orderedOptions(rows, { windowSizeForward: 1 })))
      .toThrowError('Ordered network analysis only supports backward windows; windowSizeForward must be 0; got 1.');
  });

  it.each(["AccumulatedTrajectory", "SeparateTrajectory"] as const)("rejects the %s trajectory model", (model) => {
    expect(() => accumulateData(orderedOptions(rows, { model })))
      .toThrowError(`Ordered network analysis requires model "EndPoint"; got "${model}".`);
  });

  it("rejects Conversation windows", () => {
    expect(() => accumulateData(orderedOptions(rows, { window: "Conversation" })))
      .toThrowError('Ordered network analysis requires window "MovingStanzaWindow"; got "Conversation".');
  });

  it("rejects a zero stanza window", () => {
    expect(() => accumulateData(orderedOptions(rows, { windowSizeBack: 0 })))
      .toThrowError('Ordered network analysis requires windowSizeBack to be an integer >= 1 or Infinity; got 0.');
  });

  it("rejects binary weighting because ordered accumulation preserves raw counts", () => {
    expect(() => accumulateData(orderedOptions(rows, { weightBy: "binary" })))
      .toThrowError('Ordered network analysis preserves raw code counts and requires weightBy "sum"; got "binary".');
  });

  it("rejects custom weighting because ordered accumulation preserves raw counts", () => {
    expect(() => accumulateData(orderedOptions(rows, { weightBy: (values) => values[0] ?? 0 })))
      .toThrowError('Ordered network analysis preserves raw code counts and requires weightBy "sum"; got function.');
  });

  it("rejects an unknown network type", () => {
    expect(() => accumulateData({ ...orderedOptions(rows), networkType: "ona" as never }))
      .toThrowError('networkType must be one of standard, ordered; got "ona".');
  });
});

describe("ordered network streaming and downstream modeling", () => {
  const rows: Row[] = [
    { unit: "u1", horizon: "h1", A: 2, B: 0, C: 0 },
    { unit: "u2", horizon: "h1", A: 0, B: 1, C: 1 },
    { unit: "u1", horizon: "h1", A: 0, B: 0, C: 2 },
    { unit: "u2", horizon: "h2", A: 1, B: 1, C: 0 },
    { unit: "u1", horizon: "h2", A: 0, B: 2, C: 0 }
  ];
  const options = orderedOptions(rows, {
    codes: ["A", "B", "C"],
    windowSizeBack: 3,
    mask: [[1, 1, 0], [0, 1, 1], [1, 0, 1]]
  });

  it("is byte-identical across one-shot, chunked, and manually streamed chunk boundaries", () => {
    const batch = accumulateData(options);
    for (const chunkSize of [1, 2, 4, 100]) {
      expect(accumulateDataChunked({ ...options, chunkSize })).toEqual(batch);
    }

    const stream = createAccumulationStream({ ...options, rows: [] });
    stream.push(rows.slice(0, 2));
    stream.push(rows.slice(2, 3));
    stream.push(rows.slice(3));
    expect(stream.finish()).toEqual(batch);
  });

  it("returns ordered window provenance in model materialization without raw or row-count rows", () => {
    const data = accumulateDataChunked({ ...options, chunkSize: 1, materialization: "model" });

    expect(data.rawRows).toEqual([]);
    expect(data.rowConnectionCounts).toEqual([]);
    expect(data.rowWindowProvenance).toEqual([
      { responseRowIndex: 0, horizon: "h1", priorRowIndices: [] },
      { responseRowIndex: 1, horizon: "h1", priorRowIndices: [0] },
      { responseRowIndex: 2, horizon: "h1", priorRowIndices: [0, 1] },
      { responseRowIndex: 3, horizon: "h2", priorRowIndices: [] },
      { responseRowIndex: 4, horizon: "h2", priorRowIndices: [3] }
    ]);
  });

  it("makes an ordered set with directed node positions by default", () => {
    const implicit = ena(options);
    const explicit = ena({ ...options, nodePositionMethod: "directed" });

    expect(implicit.codeColumns).toHaveLength(9);
    expect(implicit.rotation.nodes).toEqual(explicit.rotation.nodes);
    expect(implicit.centroids).toEqual(explicit.centroids);
  });

  it("rejects an explicitly undirected node-position solver for ordered data", () => {
    expect(() => ena({ ...options, nodePositionMethod: "undirected" }))
      .toThrowError('Ordered network analysis requires a directed node position method; got "undirected". Omit nodePositionMethod to use "directed".');
  });
});

describe("standard ENA regression", () => {
  it("keeps the legacy default output identical to explicit standard mode", () => {
    const rows: Row[] = [
      { unit: "u1", horizon: "h1", A: 1, B: 0, C: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 1, C: 0 },
      { unit: "u2", horizon: "h1", A: 0, B: 0, C: 1 }
    ];
    const base = {
      rows,
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B", "C"],
      windowSizeBack: 2
    };
    const legacy = accumulateData(base);
    const explicit = accumulateData({ ...base, networkType: "standard" });

    expect(explicit).toEqual(legacy);
    expect(legacy.codeColumns).toEqual(["A & B", "A & C", "B & C"]);
    expect(legacy.adjacencyKey).toEqual([
      { source: "A", target: "B", name: "A & B", sourceIndex: 0, targetIndex: 1 },
      { source: "A", target: "C", name: "A & C", sourceIndex: 0, targetIndex: 2 },
      { source: "B", target: "C", name: "B & C", sourceIndex: 1, targetIndex: 2 }
    ]);
    expect(legacy.connectionMatrix.every((row) => row.length === 3)).toBe(true);
  });
});
