import { describe, expect, it } from "vitest";
import { accumulateData, ena } from "../src/index.js";
import type { Row } from "../src/index.js";

const rows: Row[] = [
  { unit: "u1", conv: "c1", A: 1, B: 0, C: 0 },
  { unit: "u1", conv: "c1", A: 0, B: 1, C: 0 },
  { unit: "u1", conv: "c1", A: 0, B: 0, C: 1 },
  { unit: "u2", conv: "c1", A: 1, B: 1, C: 0 }
];

describe("accumulateData", () => {
  it("accumulates endpoint connection counts from moving stanza windows", () => {
    const data = accumulateData({
      rows,
      units: ["unit"],
      conversation: ["conv"],
      codes: ["A", "B", "C"],
      windowSizeBack: 2
    });

    expect(data.codeColumns).toEqual(["A & B", "A & C", "B & C"]);
    expect(data.connectionCounts).toEqual([
      { ENA_UNIT: "u1", unit: "u1", "A & B": 1, "A & C": 0, "B & C": 1 },
      { ENA_UNIT: "u2", unit: "u2", "A & B": 1, "A & C": 1, "B & C": 1 }
    ]);
  });

  it("builds an ENA set with line weights, points, and node positions", () => {
    const set = ena({
      rows,
      units: ["unit"],
      conversation: ["conv"],
      codes: ["A", "B", "C"],
      windowSizeBack: 2,
      dimensions: 2
    });

    expect(set.lineWeights).toHaveLength(2);
    expect(set.points).toHaveLength(2);
    expect(set.rotation.nodes).toHaveLength(3);
    // The rotation set carries every rotated dimension (rENA parity); the
    // variance shares are normalized across all of them and sum to 1.
    expect(set.rotation.rotationColumns).toEqual(["SVD1", "SVD2", "SVD3"]);
    expect(Object.keys(set.variance)).toEqual(["SVD1", "SVD2", "SVD3"]);
    const shareTotal = Object.values(set.variance).reduce((sum, value) => sum + value, 0);
    expect(shareTotal).toBeCloseTo(1, 9);
    // Displayed points remain truncated to the requested dimensions.
    expect(set.points[0]).toHaveProperty("SVD2");
    expect(set.points[0]).not.toHaveProperty("SVD3");
  });
});
