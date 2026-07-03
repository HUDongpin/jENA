import { describe, expect, it } from "vitest";
import {
  centerData,
  combnC2,
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
});
