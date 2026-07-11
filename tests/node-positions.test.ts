import { describe, expect, it } from "vitest";
import { ena } from "../src/index.js";
import { directedNodePositions, directedNodePositionsWithGroundResponseAdded } from "../src/rotation/index.js";
import type { Row } from "../src/index.js";

const rows: Row[] = [
  { unit: "u1", conv: "c1", A: 1, B: 0, C: 0 },
  { unit: "u1", conv: "c1", A: 0, B: 1, C: 0 },
  { unit: "u1", conv: "c1", A: 0, B: 0, C: 1 },
  { unit: "u2", conv: "c1", A: 1, B: 1, C: 0 }
];

const baseOptions = {
  rows,
  units: ["unit"],
  conversation: ["conv"],
  codes: ["A", "B", "C"],
  windowSizeBack: 2
};

// Nine codes: the undirected width 9*8/2 = 36 is coincidentally a perfect
// square (6*6), so the guard must compare against codes.length^2, not just
// check squareness.
const nineCodes = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const nineCodeRows: Row[] = [
  { unit: "u1", conv: "c1", ...Object.fromEntries(nineCodes.map((code) => [code, 1])) },
  { unit: "u2", conv: "c1", ...Object.fromEntries(nineCodes.map((code, index) => [code, index % 2])) }
];

describe("directed node-position guards (advisory F-003)", () => {
  it("rejects nodePositionMethod 'directed' on this pipeline's undirected models", () => {
    expect(() => ena({ ...baseOptions, nodePositionMethod: "directed" }))
      .toThrow(/directed adjacency.*undirected/s);
  });

  it("rejects nodePositionMethod 'directed-ground-response' on undirected models", () => {
    expect(() => ena({ ...baseOptions, nodePositionMethod: "directed-ground-response" }))
      .toThrow(/directed adjacency.*undirected/s);
  });

  it("rejects undirected widths that happen to be perfect squares", () => {
    expect(() => ena({ ...baseOptions, rows: nineCodeRows, codes: [...nineCodes], nodePositionMethod: "directed" }))
      .toThrow(/81 columns for 9 codes/);
  });

  it("rejects non-square adjacency widths in the standalone solvers", () => {
    const undirectedLineWeights = [[0.5, 0.5, 0], [0, 0.5, 0.5]]; // 3 columns = 3 codes undirected
    const points = [[0.1], [0.2]];
    expect(() => directedNodePositions(undirectedLineWeights, points)).toThrow(/n\*n columns/);
    expect(() => directedNodePositionsWithGroundResponseAdded(undirectedLineWeights, points)).toThrow(/n\*n columns/);
  });

  it("still solves genuine directed adjacency matrices (n*n columns)", () => {
    const directedLineWeights = [
      [0, 0.6, 0.4, 0],
      [0.2, 0, 0, 0.8]
    ]; // 4 columns = 2 nodes directed
    const points = [[0.1], [-0.2]];
    const result = directedNodePositions(directedLineWeights, points);
    expect(result.nodes).toHaveLength(2);
    expect(result.centroids).toHaveLength(2);
  });
});
