import { describe, expect, it } from "vitest";
import {
  centerData,
  combnC2,
  l2Norm,
  refWindowLag,
  refWindowMatrix,
  rowsToCoOccurrences,
  sphereNorm,
  stringVectorToUpperTriangle,
  triIndices,
  vectorToUpperTriangle
} from "../src/core/index.js";

describe("core matrix utilities ported from rENA", () => {
  it("matches rENA upper-triangle ordering", () => {
    expect(combnC2(3)).toEqual([[0, 0, 1], [1, 2, 2]]);
    expect(triIndices(3)).toEqual([[0, 0, 1], [1, 2, 2]]);
    expect(triIndices(3, 0)).toEqual([[0, 0, 1]]);
    expect(triIndices(3, 1)).toEqual([[1, 2, 2]]);
    expect(vectorToUpperTriangle([1, 2, 3])).toEqual([2, 3, 6]);
    expect(stringVectorToUpperTriangle(["A", "B", "C"])).toEqual(["A & B", "A & C", "B & C"]);
  });

  it("calculates binary and weighted row co-occurrences", () => {
    const input = [[1, 0, 1], [1, 2, 0]];
    expect(rowsToCoOccurrences(input, true)).toEqual([[0, 1, 0], [1, 0, 0]]);
    expect(rowsToCoOccurrences(input, false)).toEqual([[0, 1, 0], [2, 0, 0]]);
  });

  it("calculates moving windows, lag windows, normalization, and centering", () => {
    expect(refWindowMatrix([[1, 0, 0], [0, 1, 0], [0, 0, 1]], 2, 0, true)).toEqual([[0, 0, 0], [1, 0, 0], [0, 0, 1]]);
    expect(refWindowLag([[1, 0], [0, 1], [1, 1]], 2)).toEqual([[1, 0], [1, 1], [1, 2]]);
    expect(sphereNorm([[3, 4], [0, 0]])).toEqual([[0.6, 0.8], [0, 0]]);
    expect(centerData([[1, 2], [3, 4]])).toEqual([[-1, -1], [1, 1]]);
  });

  it("normalizes extreme finite vectors without overflow or underflow", () => {
    const huge = [5e299, 5e299];
    const hugeNorm = l2Norm(huge);
    const hugeNormalized = sphereNorm([huge])[0] ?? [];

    expect(Number.isFinite(hugeNorm)).toBe(true);
    expect(hugeNorm / 5e299).toBeCloseTo(Math.SQRT2, 15);
    expect(hugeNormalized[0]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(hugeNormalized[1]).toBeCloseTo(Math.SQRT1_2, 15);

    expect(l2Norm([0, -0])).toBe(0);
    expect(l2Norm([3e-300, 4e-300]) / 1e-300).toBeCloseTo(5, 15);
    expect(sphereNorm([[3e-300, 4e-300]])[0]?.[0]).toBeCloseTo(0.6, 15);
    expect(sphereNorm([[3e-300, 4e-300]])[0]?.[1]).toBeCloseTo(0.8, 15);
    expect(l2Norm([Number.MIN_VALUE, 3, 4])).toBe(5);
    expect(l2Norm([Number.NaN, 1])).toBeNaN();
    expect(l2Norm([Number.POSITIVE_INFINITY, 1])).toBe(Number.POSITIVE_INFINITY);
    expect(l2Norm([Number.NEGATIVE_INFINITY, 1])).toBe(Number.POSITIVE_INFINITY);
    expect(() => sphereNorm([[Number.NaN, 1]])).toThrowError(
      "matrix[0][0] must be a number, got NaN."
    );
  });
});
