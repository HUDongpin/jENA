import { describe, expect, it } from "vitest";
import {
  accumulateData,
  accumulateDataChunked,
  createAccumulationStream,
  ena,
  expandOrderedPriorRowIndices
} from "../src/index.js";
import type { AccumulateOptions, ENAData, OrderedWindowProvenance, Row } from "../src/index.js";

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

function provenanceEntry(overrides: Partial<OrderedWindowProvenance> = {}): OrderedWindowProvenance {
  return {
    responseRowIndex: 0,
    horizon: "h1",
    horizonIdentity: "typed-h1",
    previousRowIndex: null,
    priorRowCount: 0,
    ...overrides
  };
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

  it("keeps delimiter-colliding composite horizon tuples in separate ordered contexts", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", h1: "a::b", h2: "c", A: 1, B: 0 },
      { unit: "u1", h1: "a", h2: "b::c", A: 0, B: 1 }
    ], {
      conversation: ["h1", "h2"],
      windowSizeBack: 2
    }));

    expect(edgeValue(data.rowConnectionCounts[1]!, data, "A", "B")).toBe(0);
    expect(data.rowWindowProvenance?.[1]).toEqual(expect.objectContaining({
      responseRowIndex: 1,
      horizon: "a::b::c",
      previousRowIndex: null,
      priorRowCount: 0
    }));
    expect(expandOrderedPriorRowIndices(data.rowWindowProvenance ?? [], 1)).toEqual([]);
  });

  it("persists a collision-free horizon identity alongside the display label", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", h1: "a::b", h2: "c", A: 1, B: 0 },
      { unit: "u1", h1: "a", h2: "b::c", A: 0, B: 1 }
    ], {
      conversation: ["h1", "h2"],
      windowSizeBack: 2
    }));
    const first = data.rowWindowProvenance?.[0];
    const second = data.rowWindowProvenance?.[1];

    expect(first?.horizon).toBe("a::b::c");
    expect(second?.horizon).toBe("a::b::c");
    expect(Reflect.get(first ?? {}, "horizonIdentity")).toBeTypeOf("string");
    expect(Reflect.get(first ?? {}, "horizonIdentity"))
      .not.toBe(Reflect.get(second ?? {}, "horizonIdentity"));
  });

  it("keeps numeric and string horizon values in separate ordered contexts", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: 1, A: 1, B: 0 },
      { unit: "u1", horizon: "1", A: 0, B: 1 }
    ], { windowSizeBack: 2 }));

    expect(edgeValue(data.rowConnectionCounts[1]!, data, "A", "B")).toBe(0);
    expect(data.rowWindowProvenance?.[1]).toEqual(expect.objectContaining({
      responseRowIndex: 1,
      horizon: "1",
      previousRowIndex: null,
      priorRowCount: 0
    }));
    expect(expandOrderedPriorRowIndices(data.rowWindowProvenance ?? [], 1)).toEqual([]);
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

  it("records a compact predecessor chain that expands to the exact finite window", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 0 },
      { unit: "u2", horizon: "h2", A: 0, B: 1 },
      { unit: "u2", horizon: "h1", A: 0, B: 1 },
      { unit: "u1", horizon: "h1", A: 1, B: 0 }
    ], { windowSizeBack: 2 }));

    expect(data.rowWindowProvenance).toEqual([
      expect.objectContaining({ responseRowIndex: 0, horizon: "h1", previousRowIndex: null, priorRowCount: 0 }),
      expect.objectContaining({ responseRowIndex: 1, horizon: "h2", previousRowIndex: null, priorRowCount: 0 }),
      expect.objectContaining({ responseRowIndex: 2, horizon: "h1", previousRowIndex: 0, priorRowCount: 1 }),
      expect.objectContaining({ responseRowIndex: 3, horizon: "h1", previousRowIndex: 2, priorRowCount: 1 })
    ]);
    expect(expandOrderedPriorRowIndices(data.rowWindowProvenance ?? [], 2)).toEqual([0]);
    expect(expandOrderedPriorRowIndices(data.rowWindowProvenance ?? [], 3)).toEqual([2]);
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

  it("rejects ordered headers that collide before asymmetric mass can be overwritten", () => {
    const ambiguousCodes = ["A", "A & A"];
    const asymmetricRows: Row[] = [
      { unit: "u1", horizon: "h1", A: 0, "A & A": 1 },
      { unit: "u1", horizon: "h1", A: 1, "A & A": 0 }
    ];

    expect(() => accumulateData(orderedOptions(asymmetricRows, {
      codes: ambiguousCodes,
      windowSizeBack: 2
    }))).toThrowError(
      'Ordered adjacency headers collide; use unambiguous code labels so every "<ground> & <response>" header is unique.'
    );
  });

  it("rejects duplicate code labels", () => {
    expect(() => accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 0 }
    ], { codes: ["A", "A"] }))).toThrowError('codes must contain unique column labels; duplicate "A".');
  });

  it("rejects distinct composite unit tuples with the same legacy display label", () => {
    const collidingUnits: Row[] = [
      { u1: "a::b", u2: "c", horizon: "h1", A: 1, B: 0 },
      { u1: "a", u2: "b::c", horizon: "h1", A: 0, B: 1 }
    ];

    expect(() => accumulateData(orderedOptions(collidingUnits, {
      units: ["u1", "u2"],
      windowSizeBack: 2
    }))).toThrowError(
      'Ordered network analysis unit label collision: distinct typed unit tuples format as "a::b::c"; use unambiguous unit values or columns.'
    );
  });
});

describe("ordered window provenance validation", () => {
  it("rejects a non-array persisted provenance container", () => {
    expect(() => expandOrderedPriorRowIndices(null as never, 0)).toThrowError(
      "Ordered window provenance must be an array."
    );
  });

  it("rejects a non-object persisted provenance entry", () => {
    const persisted = [null as never];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance entry must be an object; got null."
    );
  });

  it("rejects a persisted negative response row index", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: -1 }),
      provenanceEntry({ responseRowIndex: 0 })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance responseRowIndex must be a non-negative integer; got -1."
    );
  });

  it("rejects a persisted fractional response row index", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0.5 }),
      provenanceEntry({ responseRowIndex: 0 })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance responseRowIndex must be a non-negative integer; got 0.5."
    );
  });

  it("rejects a persisted response row index outside JavaScript's safe integer range", () => {
    const unsafeIndex = Number.MAX_SAFE_INTEGER + 1;
    const persisted = [provenanceEntry({ responseRowIndex: unsafeIndex })];

    expect(() => expandOrderedPriorRowIndices(persisted, unsafeIndex)).toThrowError(
      `responseRowIndex must be a non-negative integer; got ${unsafeIndex}.`
    );
  });

  it("rejects a persisted negative prior row count", () => {
    const persisted = [provenanceEntry({ priorRowCount: -1 })];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance priorRowCount for response row 0 must be a non-negative integer; got -1."
    );
  });

  it("rejects a persisted fractional prior row count", () => {
    const persisted = [provenanceEntry({ priorRowCount: 0.5 })];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance priorRowCount for response row 0 must be a non-negative integer; got 0.5."
    );
  });

  it("rejects a persisted negative previous row index", () => {
    const persisted = [provenanceEntry({ previousRowIndex: -1 })];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance previousRowIndex for response row 0 must be null or a non-negative integer; got -1."
    );
  });

  it("rejects a persisted fractional previous row index", () => {
    const persisted = [provenanceEntry({ previousRowIndex: 0.5 })];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance previousRowIndex for response row 0 must be null or a non-negative integer; got 0.5."
    );
  });

  it("rejects a self predecessor", () => {
    const persisted = [provenanceEntry({ responseRowIndex: 1, previousRowIndex: 1 })];

    expect(() => expandOrderedPriorRowIndices(persisted, 1)).toThrowError(
      "Ordered window provenance previousRowIndex for response row 1 must be strictly less than responseRowIndex; got 1."
    );
  });

  it("rejects a future predecessor", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 1, previousRowIndex: 2 }),
      provenanceEntry({ responseRowIndex: 2 })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 1)).toThrowError(
      "Ordered window provenance previousRowIndex for response row 1 must be strictly less than responseRowIndex; got 2."
    );
  });

  it("rejects a persisted entry missing horizonIdentity", () => {
    const { horizonIdentity: _omitted, ...missingIdentity } = provenanceEntry();
    const persisted = [missingIdentity as OrderedWindowProvenance];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance horizonIdentity for response row 0 must be a non-empty string; got undefined."
    );
  });

  it("rejects a persisted entry missing its horizon display label", () => {
    const { horizon: _omitted, ...missingHorizon } = provenanceEntry();
    const persisted = [missingHorizon as OrderedWindowProvenance];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance horizon for response row 0 must be a string; got undefined."
    );
  });

  it("rejects a predecessor from another typed horizon", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0, horizonIdentity: "typed-h1" }),
      provenanceEntry({
        responseRowIndex: 1,
        horizon: "same-display",
        horizonIdentity: "typed-h2",
        previousRowIndex: 0,
        priorRowCount: 1
      })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 1)).toThrowError(
      "Ordered window provenance for response row 1 crosses horizonIdentity at predecessor row 0."
    );
  });

  it("rejects different horizon displays assigned to the same typed identity", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0, horizon: "display-one" }),
      provenanceEntry({
        responseRowIndex: 1,
        horizon: "display-two",
        previousRowIndex: 0,
        priorRowCount: 1
      })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 1)).toThrowError(
      'Ordered window provenance horizonIdentity "typed-h1" has inconsistent horizon displays: "display-one" and "display-two".'
    );
  });

  it("rejects a missing persisted predecessor even when the current window count is zero", () => {
    const persisted = [provenanceEntry({
      responseRowIndex: 1,
      previousRowIndex: 0,
      priorRowCount: 0
    })];

    expect(() => expandOrderedPriorRowIndices(persisted, 1)).toThrowError(
      "Ordered window provenance is missing predecessor row 0 for response row 1."
    );
  });

  it("rejects a persisted predecessor cycle", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0, previousRowIndex: 1 }),
      provenanceEntry({ responseRowIndex: 1, previousRowIndex: 0, priorRowCount: 1 })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 1)).toThrowError(
      "Ordered window provenance contains a predecessor cycle involving response row 0."
    );
  });

  it("rejects a prior row count inconsistent with its predecessor chain", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0, priorRowCount: 0 }),
      provenanceEntry({ responseRowIndex: 1, previousRowIndex: 0, priorRowCount: 1 }),
      provenanceEntry({ responseRowIndex: 2, previousRowIndex: 1, priorRowCount: 0 })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 2)).toThrowError(
      "Ordered window provenance priorRowCount for response row 2 must equal its predecessor count or increase by one; " +
      "predecessor row 1 has 1, got 0."
    );
  });

  it("rejects a chain root that claims prior rows even when expanding another response", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0, priorRowCount: 1 }),
      provenanceEntry({ responseRowIndex: 2, horizonIdentity: "typed-h2" })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 2)).toThrowError(
      "Ordered window provenance priorRowCount for response row 0 must be 0 when previousRowIndex is null; got 1."
    );
  });

  it("rejects a chain that skips the immediate predecessor in the same typed horizon", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0 }),
      provenanceEntry({ responseRowIndex: 1, previousRowIndex: 0, priorRowCount: 1 }),
      provenanceEntry({ responseRowIndex: 2, previousRowIndex: 0, priorRowCount: 1 })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 2)).toThrowError(
      "Ordered window provenance previousRowIndex for response row 2 must reference the immediately preceding response row " +
      "in its horizonIdentity; expected 1, got 0."
    );
  });

  it("rejects a prior-row count that grows after reaching its fixed-window plateau", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0 }),
      provenanceEntry({ responseRowIndex: 1, previousRowIndex: 0, priorRowCount: 0 }),
      provenanceEntry({ responseRowIndex: 2, previousRowIndex: 1, priorRowCount: 1 })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 2)).toThrowError(
      "Ordered window provenance priorRowCount for response row 2 cannot increase after its horizon chain reached " +
      "the fixed-window plateau 0; got 1."
    );
  });

  it("rejects different fixed-window plateaus across typed horizons", () => {
    const persisted = [
      provenanceEntry({ responseRowIndex: 0, horizon: "h1", horizonIdentity: "typed-h1" }),
      provenanceEntry({
        responseRowIndex: 1,
        horizon: "h1",
        horizonIdentity: "typed-h1",
        previousRowIndex: 0,
        priorRowCount: 0
      }),
      provenanceEntry({
        responseRowIndex: 2,
        horizon: "h1",
        horizonIdentity: "typed-h1",
        previousRowIndex: 1,
        priorRowCount: 0
      }),
      provenanceEntry({ responseRowIndex: 3, horizon: "h2", horizonIdentity: "typed-h2" }),
      provenanceEntry({
        responseRowIndex: 4,
        horizon: "h2",
        horizonIdentity: "typed-h2",
        previousRowIndex: 3,
        priorRowCount: 1
      }),
      provenanceEntry({
        responseRowIndex: 5,
        horizon: "h2",
        horizonIdentity: "typed-h2",
        previousRowIndex: 4,
        priorRowCount: 1
      })
    ];

    expect(() => expandOrderedPriorRowIndices(persisted, 5)).toThrowError(
      "Ordered window provenance priorRowCount for response row 1 is inconsistent with one global fixed window: " +
      "expected 1 at horizon position 1 with observed prior-row limit 1, got 0."
    );
  });

  it("rejects an invalid persisted previous row index type", () => {
    const persisted = [provenanceEntry({ previousRowIndex: "zero" as never })];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance previousRowIndex for response row 0 must be null or a non-negative integer; got zero."
    );
  });

  it("rejects a duplicate persisted response row index", () => {
    const persisted = [provenanceEntry(), provenanceEntry()];

    expect(() => expandOrderedPriorRowIndices(persisted, 0)).toThrowError(
      "Ordered window provenance contains duplicate responseRowIndex 0."
    );
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
      expect.objectContaining({ responseRowIndex: 0, horizon: "h1", previousRowIndex: null, priorRowCount: 0 }),
      expect.objectContaining({ responseRowIndex: 1, horizon: "h1", previousRowIndex: 0, priorRowCount: 1 }),
      expect.objectContaining({ responseRowIndex: 2, horizon: "h1", previousRowIndex: 1, priorRowCount: 2 }),
      expect.objectContaining({ responseRowIndex: 3, horizon: "h2", previousRowIndex: null, priorRowCount: 0 }),
      expect.objectContaining({ responseRowIndex: 4, horizon: "h2", previousRowIndex: 3, priorRowCount: 1 })
    ]);
    expect(expandOrderedPriorRowIndices(data.rowWindowProvenance ?? [], 2)).toEqual([0, 1]);
  });

  it("keeps a 2000-row Infinity window linear and expands exact provenance on demand", () => {
    const rowCount = 2_000;
    const longRows: Row[] = Array.from({ length: rowCount }, (_unused, index) => ({
      unit: "u1",
      horizon: "long",
      A: 1,
      B: 0,
      row: index
    }));
    const stream = createAccumulationStream({
      units: ["unit"],
      conversation: ["horizon"],
      codes,
      networkType: "ordered",
      windowSizeBack: Number.POSITIVE_INFINITY,
      materialization: "model",
      expectedRows: rowCount
    });
    for (let index = 0; index < rowCount; index += 100) {
      stream.push(longRows.slice(index, index + 100));
    }
    const data = stream.finish();
    const provenance = data.rowWindowProvenance ?? [];
    const finalEntry = provenance[rowCount - 1];

    expect(provenance).toHaveLength(rowCount);
    expect(finalEntry).toEqual(expect.objectContaining({
      responseRowIndex: rowCount - 1,
      horizon: "long",
      previousRowIndex: rowCount - 2,
      priorRowCount: rowCount - 1
    }));
    expect(Object.hasOwn(finalEntry ?? {}, "priorRowIndices")).toBe(false);
    expect(JSON.stringify(provenance).length).toBeLessThan(rowCount * 160);
    expect(stream.state.activeBufferedRowsPeak).toBeLessThanOrEqual(1);
    expect(stream.state.activeBufferedRows).toBe(0);
    const expanded = expandOrderedPriorRowIndices(provenance, rowCount - 1);
    expect(expanded).toHaveLength(rowCount - 1);
    expect(expanded[0]).toBe(0);
    expect(expanded.at(-1)).toBe(rowCount - 2);
    expect(edgeValue(data.connectionCounts[0]!, data, "A", "A")).toBe(rowCount * (rowCount - 1) / 2);
  });

  it("keeps a large finite ordered window bounded without shifting history rows", () => {
    const rowCount = 5_000;
    const windowSizeBack = 257;
    const priorLimit = windowSizeBack - 1;
    const longRows: Row[] = Array.from({ length: rowCount }, () => ({
      unit: "u1",
      horizon: "finite",
      A: 1,
      B: 0
    }));
    const originalShift = Array.prototype.shift;
    let historyShiftCount = 0;
    Array.prototype.shift = function countedShift<T>(this: T[]): T | undefined {
      historyShiftCount += 1;
      return originalShift.call(this);
    };

    try {
      const stream = createAccumulationStream({
        units: ["unit"],
        conversation: ["horizon"],
        codes,
        networkType: "ordered",
        windowSizeBack,
        materialization: "model",
        expectedRows: rowCount
      });
      for (let index = 0; index < rowCount; index += 100) {
        stream.push(longRows.slice(index, index + 100));
      }
      const data = stream.finish();
      const expectedSelfMass = priorLimit * (priorLimit + 1) / 2 +
        (rowCount - priorLimit - 1) * priorLimit;

      expect(historyShiftCount).toBe(0);
      expect(stream.state.activeBufferedRowsPeak).toBe(priorLimit);
      expect(data.rowWindowProvenance?.at(-1)).toEqual(expect.objectContaining({
        responseRowIndex: rowCount - 1,
        priorRowCount: priorLimit
      }));
      expect(edgeValue(data.connectionCounts[0]!, data, "A", "A")).toBe(expectedSelfMass);
    } finally {
      Array.prototype.shift = originalShift;
    }
  });

  it("makes an ordered set with directed node positions by default", () => {
    const implicit = ena(options);
    const explicit = ena({ ...options, nodePositionMethod: "directed" });

    expect(implicit.codeColumns).toHaveLength(9);
    expect(implicit.rotation.nodes).toEqual(explicit.rotation.nodes);
    expect(implicit.centroids).toEqual(explicit.centroids);
  });

  it("keeps finite 5e299 ordered edges nonzero through normalization and projection", () => {
    const huge = 5e299;
    const set = ena(orderedOptions([
      { unit: "u1", horizon: "h1", A: huge, B: 0, C: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 1, C: 0 },
      { unit: "u2", horizon: "h2", A: huge, B: 0, C: 0 },
      { unit: "u2", horizon: "h2", A: 0, B: 0, C: 1 },
      { unit: "u3", horizon: "h3", A: 0, B: huge, C: 0 },
      { unit: "u3", horizon: "h3", A: 0, B: 0, C: 1 }
    ], {
      codes: ["A", "B", "C"],
      windowSizeBack: 2
    }));

    expect(edgeValue(set.connectionCounts[0]!, set, "A", "B")).toBe(huge);
    expect(edgeValue(set.connectionCounts[1]!, set, "A", "C")).toBe(huge);
    expect(edgeValue(set.connectionCounts[2]!, set, "B", "C")).toBe(huge);

    const lineWeightRows = set.lineWeights.map((row) =>
      set.codeColumns.map((column) => Number(row[column]))
    );
    expect(lineWeightRows.every((row) => row.every(Number.isFinite))).toBe(true);
    expect(lineWeightRows.every((row) => row.some((value) => value !== 0))).toBe(true);
    for (const row of lineWeightRows) expect(Math.hypot(...row)).toBeCloseTo(1, 15);

    const pointColumns = set.rotation.rotationColumns.slice(0, 2);
    const pointValues = set.points.flatMap((row) =>
      pointColumns.map((column) => Number(row[column]))
    );
    expect(pointValues.every(Number.isFinite)).toBe(true);
    expect(pointValues.some((value) => Math.abs(value) > 1e-12)).toBe(true);
  });

  it("rejects finite raw ordered counts whose derived edge is non-finite", () => {
    expect(() => accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 2 }
    ], { windowSizeBack: 2 }))).toThrowError(
      /Ordered network analysis derived a non-finite connection at edge index 2 \(A -> B\); got Infinity\./
    );
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
