import { describe, expect, it } from "vitest";
import { accumulateData, createAccumulationStream, ena } from "../src/index.js";
import type { ENAOptions, Row } from "../src/index.js";

const rows: Row[] = [
  { unit: "u1", conv: "c1", A: 1, B: 0, C: 0 },
  { unit: "u1", conv: "c1", A: 0, B: 1, C: 0 },
  { unit: "u2", conv: "c1", A: 1, B: 1, C: 1 }
];

const good: ENAOptions = {
  rows,
  units: ["unit"],
  conversation: ["conv"],
  codes: ["A", "B", "C"],
  windowSizeBack: 2
};

type RejectionCase = {
  name: string;
  options: Partial<ENAOptions>;
  message: RegExp;
};

// Advisory F-011: every malformed input is rejected with a message that names
// the offending option, instead of silently producing wrong numbers.
const rejections: RejectionCase[] = [
  { name: "empty rows", options: { rows: [] }, message: /rows is empty/ },
  { name: "single code", options: { codes: ["A"] }, message: /codes must list at least 2/ },
  { name: "no codes", options: { codes: [] }, message: /codes must list at least 2/ },
  { name: "negative windowSizeBack", options: { windowSizeBack: -2 }, message: /windowSizeBack must be a non-negative integer/ },
  { name: "fractional windowSizeBack", options: { windowSizeBack: 1.5 }, message: /windowSizeBack must be a non-negative integer/ },
  { name: "NaN windowSizeBack", options: { windowSizeBack: Number.NaN }, message: /windowSizeBack must be a non-negative integer/ },
  { name: "negative windowSizeForward", options: { windowSizeForward: -1 }, message: /windowSizeForward must be a non-negative integer/ },
  { name: "wrong-size mask", options: { mask: [[1]] }, message: /mask must be a 3x3 matrix/ },
  { name: "ragged mask", options: { mask: [[1, 1, 1], [1, 1], [1, 1, 1]] }, message: /mask row 1 must have 3 columns/ },
  { name: "non-finite mask entry", options: { mask: [[1, 1, 1], [1, Number.NaN, 1], [1, 1, 1]] }, message: /mask\[1\]\[1\] must be a finite number/ },
  { name: "misspelled model", options: { model: "Endpoint" as never }, message: /model must be one of/ },
  { name: "misspelled window", options: { window: "Moving" as never }, message: /window must be one of/ },
  { name: "misspelled weightBy", options: { weightBy: "Binary" as never }, message: /weightBy must be/ },
  { name: "zero dimensions", options: { dimensions: 0 }, message: /dimensions must be an integer >= 1/ },
  { name: "fractional dimensions", options: { dimensions: 1.5 }, message: /dimensions must be an integer >= 1/ },
  { name: "unknown rotation method", options: { rotation: { method: "pca" as never } }, message: /rotation\.method must be one of/ },
  { name: "unknown node position method", options: { nodePositionMethod: "circular" as never }, message: /nodePositionMethod must be one of/ },
  { name: "empty unitsUsed", options: { unitsUsed: [] }, message: /unitsUsed must be a non-empty array/ },
  { name: "unitsUsed matching nothing", options: { unitsUsed: ["nobody"] }, message: /unitsUsed did not match any accumulated units/ }
];

describe("input validation (advisory F-011)", () => {
  for (const rejection of rejections) {
    it(`rejects ${rejection.name}`, () => {
      expect(() => ena({ ...good, ...rejection.options })).toThrow(rejection.message);
    });
  }

  it("accepts Infinity windows, custom weightBy functions, and valid masks", () => {
    const set = ena({
      ...good,
      windowSizeBack: Number.POSITIVE_INFINITY,
      weightBy: (values) => (values[0] ?? 0) > 0 ? 1 : 0,
      mask: [[0, 1, 1], [1, 0, 1], [1, 1, 0]]
    });
    expect(set.points.length).toBeGreaterThan(0);
  });

  it("accepts unitsUsed that matches a subset of units", () => {
    const set = ena({ ...good, unitsUsed: ["u1"] });
    expect(set.unitLabels).toEqual(["u1"]);
  });

  it("validates option shapes on the streaming path too", () => {
    expect(() => createAccumulationStream({ units: ["unit"], conversation: ["conv"], codes: ["A"] }))
      .toThrow(/codes must list at least 2/);
    expect(() => createAccumulationStream({ units: ["unit"], conversation: ["conv"], codes: ["A", "B"], windowSizeBack: -1 }))
      .toThrow(/windowSizeBack/);
  });

  it("keeps accumulateData's misleading co-occurrence error replaced by a named one", () => {
    expect(() => accumulateData({ ...good, rows: [] })).toThrow(/rows is empty/);
  });
});
