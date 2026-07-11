import { describe, expect, it } from "vitest";
import { ena } from "../src/index.js";
import type { ENAOptions, Row } from "../src/index.js";

// rotateBySpherical is a jena-specific extension with NO rENA counterpart
// (verified: rENA 0.3.1 exports no spherical rotation). These tests lock its
// documented spec: the first axis is anchored at a chosen adjacency
// direction, the secondary anchor is orthogonalized against it, and the
// remaining basis is an orthonormal completion.

const rows: Row[] = [
  { unit: "u1", conv: "c1", A: 1, B: 0, C: 1, D: 0 },
  { unit: "u1", conv: "c1", A: 0, B: 1, C: 0, D: 1 },
  { unit: "u2", conv: "c1", A: 1, B: 1, C: 0, D: 0 },
  { unit: "u2", conv: "c1", A: 0, B: 0, C: 1, D: 1 },
  { unit: "u3", conv: "c1", A: 1, B: 0, C: 0, D: 1 },
  { unit: "u3", conv: "c1", A: 0, B: 1, C: 1, D: 0 }
];

const base: ENAOptions = {
  rows,
  units: ["unit"],
  conversation: ["conv"],
  codes: ["A", "B", "C", "D"],
  windowSizeBack: 2
};

function rotationColumnVector(matrix: number[][], column: number): number[] {
  return matrix.map((row) => row[column] ?? 0);
}

describe("spherical rotation (jena extension, no rENA counterpart)", () => {
  it("anchors the first axis exactly at the named adjacency column", () => {
    const set = ena({ ...base, rotation: { method: "spherical", params: { anchor: "B & C" } } });
    const index = set.codeColumns.indexOf("B & C");
    const firstAxis = rotationColumnVector(set.rotation.rotationMatrix, 0);
    firstAxis.forEach((value, row) => {
      expect(value).toBeCloseTo(row === index ? 1 : 0, 12);
    });
    // Points on SPH1 are exactly the centered co-occurrence values of the
    // anchored column.
    expect(set.rotation.rotationColumns[0]).toBe("SPH1");
    set.points.forEach((point, row) => {
      const projected = Number(set.pointsForProjection[row]?.["B & C"] ?? Number.NaN);
      expect(Number(point.SPH1)).toBeCloseTo(projected, 12);
    });
  });

  it("normalizes custom vector anchors and orthogonalizes the secondary anchor", () => {
    const width = 6; // 4 codes -> 6 adjacency columns
    const anchor = Array.from({ length: width }, (_unused, index) => (index === 0 ? 2 : 0)); // non-unit on purpose
    const secondary = Array.from({ length: width }, () => 1); // overlaps the first axis
    const set = ena({ ...base, rotation: { method: "spherical", params: { anchor, secondaryAnchor: secondary } } });
    const first = rotationColumnVector(set.rotation.rotationMatrix, 0);
    const second = rotationColumnVector(set.rotation.rotationMatrix, 1);
    expect(Math.hypot(...first)).toBeCloseTo(1, 12);
    expect(Math.hypot(...second)).toBeCloseTo(1, 12);
    const dot = first.reduce((total, value, index) => total + value * (second[index] ?? 0), 0);
    expect(Math.abs(dot)).toBeLessThan(1e-12);
  });

  it("produces a fully orthonormal rotation matrix", () => {
    const set = ena({ ...base, rotation: { method: "spherical", params: { anchor: "A & B", secondaryAnchor: "C & D" } } });
    const matrix = set.rotation.rotationMatrix;
    const width = matrix[0]?.length ?? 0;
    for (let i = 0; i < width; i += 1) {
      for (let j = i; j < width; j += 1) {
        const dot = matrix.reduce((total, row) => total + (row[i] ?? 0) * (row[j] ?? 0), 0);
        expect(dot, `column ${i} . column ${j}`).toBeCloseTo(i === j ? 1 : 0, 10);
      }
    }
    // Orthonormal basis conserves variance: shares sum to 1.
    const total = Object.values(set.variance).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it("collapses to a single anchored axis when the secondary anchor is parallel", () => {
    const set = ena({ ...base, rotation: { method: "spherical", params: { anchor: "A & B", secondaryAnchor: "A & B" } } });
    expect(set.rotation.rotationColumns[0]).toBe("SPH1");
    expect(set.rotation.rotationColumns[1]).toMatch(/^SVD/);
  });

  it("rejects unknown anchors and wrong-length vectors", () => {
    expect(() => ena({ ...base, rotation: { method: "spherical", params: { anchor: "Nope & Nada" } } }))
      .toThrow(/Unknown spherical rotation anchor/);
    expect(() => ena({ ...base, rotation: { method: "spherical", params: { anchor: [1, 0] } } }))
      .toThrow(/anchor length must match/);
  });
});
