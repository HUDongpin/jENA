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

const standaloneDirectedSolvers = [
  { name: "directedNodePositions", solve: directedNodePositions },
  {
    name: "directedNodePositionsWithGroundResponseAdded",
    solve: directedNodePositionsWithGroundResponseAdded
  }
] as const;

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

  it("counts a directed self edge once and a non-self edge at both endpoints", () => {
    // Ordered column-major order for A,B is A->A, B->A, A->B, B->B.
    const directedLineWeights = [
      [1, 0, 1, 0],
      [0, 1, 0, 1]
    ];
    const result = directedNodePositions(directedLineWeights, [[0.1], [-0.2]]);

    expect(result.weights[0]?.[0]).toBeCloseTo(2 / 3, 12);
    expect(result.weights[0]?.[1]).toBeCloseTo(1 / 3, 12);
    expect(result.weights[1]?.[0]).toBeCloseTo(1 / 3, 12);
    expect(result.weights[1]?.[1]).toBeCloseTo(2 / 3, 12);
  });

  it("rejects an odd number of standalone ground-response rows", () => {
    const lineWeights = [
      [1, 0, 0, 0],
      [0, 0, 1, 0],
      [0, 1, 0, 0]
    ];
    const points = [[0.1], [0.2], [0.3]];

    expect(() => directedNodePositionsWithGroundResponseAdded(lineWeights, points)).toThrowError(
      'directedNodePositionsWithGroundResponseAdded requires an even number of paired ground/response rows; got 3.'
    );
  });

  it("rejects a short non-first adjacency row in the directed solver", () => {
    const lineWeights = [
      [1, 0, 0, 0],
      [0, 1, 0]
    ];
    const points = [[0.1], [0.2]];

    expect(() => directedNodePositions(lineWeights, points)).toThrowError(
      'directedNodePositions lineWeights row 1 must contain 4 directed adjacency cells matching row 0; got 3.'
    );
  });

  it("rejects non-finite directed adjacency cells", () => {
    const lineWeights = [
      [1, 0, 0, 0],
      [0, 1, Number.NaN, 0]
    ];
    const points = [[0.1], [0.2]];

    expect(() => directedNodePositions(lineWeights, points)).toThrowError(
      'directedNodePositions lineWeights[1][2] must be a finite number; got NaN.'
    );
  });

  it("rejects ragged point rows in the directed solver", () => {
    const lineWeights = [
      [1, 0, 0, 0],
      [0, 1, 0, 0]
    ];
    const points = [[0.1, 0.2], [0.3]];

    expect(() => directedNodePositions(lineWeights, points)).toThrowError(
      'directedNodePositions points row 1 must contain 2 dimensions matching row 0; got 1.'
    );
  });

  it.each(standaloneDirectedSolvers)(
    "$name rejects both short and long later adjacency rows",
    ({ name, solve }) => {
      const points = [[0.1], [0.2]];
      for (const laterRow of [[0, 1, 0], [0, 1, 0, 0, 7]]) {
        expect(() => solve([[1, 0, 0, 0], laterRow], points)).toThrowError(
          `${name} lineWeights row 1 must contain 4 directed adjacency cells matching row 0; got ${laterRow.length}.`
        );
      }
    }
  );

  it.each(standaloneDirectedSolvers)(
    "$name rejects ragged and non-finite point matrices",
    ({ name, solve }) => {
      const lineWeights = [[1, 0, 0, 0], [0, 1, 0, 0]];

      expect(() => solve(lineWeights, [[0.1, 0.2], [0.3]])).toThrowError(
        `${name} points row 1 must contain 2 dimensions matching row 0; got 1.`
      );
      expect(() => solve(lineWeights, [[0.1], [Number.POSITIVE_INFINITY]])).toThrowError(
        `${name} points[1][0] must be a finite number; got Infinity.`
      );
    }
  );

  it.each(standaloneDirectedSolvers)(
    "$name rejects row-count disagreement and non-finite adjacency values",
    ({ name, solve }) => {
      expect(() => solve([[1, 0, 0, 0], [0, 1, 0, 0]], [[0.1]]))
        .toThrowError("lineWeights and points must have the same number of rows.");
      expect(() => solve(
        [[1, 0, 0, 0], [0, 1, 0, Number.POSITIVE_INFINITY]],
        [[0.1], [0.2]]
      )).toThrowError(
        `${name} lineWeights[1][3] must be a finite number; got Infinity.`
      );
    }
  );
});
