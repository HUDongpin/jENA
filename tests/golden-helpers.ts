import { expect } from "vitest";
import type { ENASet, Matrix, Row } from "../src/index.js";

export type Tolerance = { atol: number; rtol: number };

export const POINT_TOLERANCE: Tolerance = { atol: 5e-7, rtol: 0 };
// Node positions solve least-squares systems that are singular on these small
// fixtures (rENA's own solver warns "system is singular; attempting approx
// solution" here). jena's documented 1e-10 ridge and Armadillo's approximate
// solve both approach the same minimum-norm solution, but only to a few 1e-6
// — see NUMERICS.md. Semantic regressions move nodes by orders of magnitude
// more than this bound.
export const NODE_TOLERANCE: Tolerance = { atol: 4e-6, rtol: 2e-6 };

// Shares below this threshold correspond to numerically null directions where
// eigenvector orientation is arbitrary, so those columns are not comparable.
export const NEGLIGIBLE_VARIANCE_SHARE = 1e-9;

export type ProjectionGolden = {
  points: Row[];
  nodes: Row[];
  rotationMatrix: Row[];
  variance: number[];
};

export function codeColumns(codes: string[]): string[] {
  const columns: string[] = [];
  for (let target = 1; target < codes.length; target += 1) {
    for (let source = 0; source < target; source += 1) {
      columns.push(`${codes[source]} & ${codes[target]}`);
    }
  }
  return columns;
}

export function matrixFromRows(rows: Row[], columns: string[]): Matrix {
  return rows.map((row) => columns.map((column) => Number(row[column] ?? 0)));
}

export function expectMatrixClose(actual: Matrix, expected: Matrix, precision = 12) {
  expect(actual.length).toBe(expected.length);
  for (let row = 0; row < expected.length; row += 1) {
    expect(actual[row]?.length).toBe(expected[row]?.length);
    for (let column = 0; column < (expected[row]?.length ?? 0); column += 1) {
      expect(actual[row]?.[column] ?? 0).toBeCloseTo(expected[row]?.[column] ?? 0, precision);
    }
  }
}

// rENA dimension signs are arbitrary (SVD sign indeterminacy), so columns are
// compared up to a per-column sign chosen by the dot product with the golden.
export function columnSign(actual: number[], expected: number[]): number {
  const dot = expected.reduce((total, value, index) => total + value * (actual[index] ?? 0), 0);
  return dot < 0 ? -1 : 1;
}

export function expectProjectedRowsClose(actual: Row[], expected: Row[], columns: string[], tolerance: Tolerance) {
  expect(actual.length).toBe(expected.length);
  for (const column of columns) {
    const actualValues = actual.map((row) => Number(row[column] ?? 0));
    const expectedValues = expected.map((row) => Number(row[column] ?? 0));
    const sign = columnSign(actualValues, expectedValues);
    for (let row = 0; row < expectedValues.length; row += 1) {
      const expectedValue = expectedValues[row] ?? 0;
      const difference = Math.abs((actualValues[row] ?? 0) * sign - expectedValue);
      const bound = tolerance.atol + tolerance.rtol * Math.abs(expectedValue);
      expect(difference, `${column} row ${row}: |${(actualValues[row] ?? 0) * sign} - ${expectedValue}|`).toBeLessThanOrEqual(bound);
    }
  }
}

export function expectStringColumns(actual: Row[], expected: Row[], columns: string[]) {
  expect(actual.length).toBe(expected.length);
  for (let row = 0; row < expected.length; row += 1) {
    for (const column of columns) {
      expect(String(actual[row]?.[column] ?? "")).toBe(String(expected[row]?.[column] ?? ""));
    }
  }
}

export function fixtureRotationColumns(config: { rotationMatrix: Row[] }): string[] {
  const first = config.rotationMatrix[0] ?? {};
  return Object.keys(first).filter((key) => key !== "codes");
}

/**
 * Asserts a jena ENASet against an rENA golden: rotation column names
 * (rENA's rank-retained columns must be a prefix of jena's), projected
 * points and node positions for the displayed dimensions, variance shares
 * over all rotated dimensions, and the rotation matrix column-by-column up
 * to sign wherever the direction carries non-negligible variance.
 */
export function expectProjectionParity(set: ENASet, config: ProjectionGolden, datasetColumns: string[], displayDimensions: number) {
  const goldenColumns = fixtureRotationColumns(config);
  expect(set.rotation.rotationColumns.slice(0, goldenColumns.length)).toEqual(goldenColumns);

  const displayColumns = goldenColumns.slice(0, displayDimensions);
  expectProjectedRowsClose(set.points, config.points, displayColumns, POINT_TOLERANCE);
  const nodes = set.rotation.nodes ?? [];
  expectStringColumns(nodes, config.nodes, ["code"]);
  expectProjectedRowsClose(nodes, config.nodes, displayColumns, NODE_TOLERANCE);

  // Variance parity is junk-aware: rENA's prcomp keeps min(n, k) columns and
  // its numerically-null trailing directions come from LAPACK's arbitrary
  // null-space basis, which can absorb a real variance share (observed at
  // ~5% on the regression-rotation fixtures — see NUMERICS.md). jena
  // completes those directions orthogonally to the data instead, so shares
  // are compared renormalized over the columns that carry variance on BOTH
  // sides. For SVD/mean rotations no such junk exists and this reduces to a
  // strict per-column check.
  const shares = set.rotation.rotationColumns.map((column) => set.variance[column] ?? 0);
  expect(shares.length).toBeGreaterThanOrEqual(config.variance.length);
  const realIndices: number[] = [];
  for (let index = 0; index < config.variance.length; index += 1) {
    if ((config.variance[index] ?? 0) >= NEGLIGIBLE_VARIANCE_SHARE && (shares[index] ?? 0) >= NEGLIGIBLE_VARIANCE_SHARE) {
      realIndices.push(index);
    }
  }
  expect(realIndices.length, "commonly spanned variance columns").toBeGreaterThanOrEqual(displayDimensions);
  const goldenRealTotal = realIndices.reduce((sum, index) => sum + (config.variance[index] ?? 0), 0);
  const jenaRealTotal = realIndices.reduce((sum, index) => sum + (shares[index] ?? 0), 0);
  for (const index of realIndices) {
    expect((shares[index] ?? 0) / jenaRealTotal, `variance share ${index} (renormalized)`)
      .toBeCloseTo((config.variance[index] ?? 0) / goldenRealTotal, 9);
  }
  for (let index = config.variance.length; index < shares.length; index += 1) {
    expect(Math.abs(shares[index] ?? 0), `extra variance share ${index}`).toBeLessThan(NEGLIGIBLE_VARIANCE_SHARE);
  }

  const jenaRotationRows = new Map<string, number[]>();
  set.rotation.rotationMatrix.forEach((row, index) => {
    jenaRotationRows.set(datasetColumns[index] ?? String(index), row);
  });
  for (let columnIndex = 0; columnIndex < goldenColumns.length; columnIndex += 1) {
    if (!realIndices.includes(columnIndex)) continue;
    const columnName = goldenColumns[columnIndex] ?? "";
    const expectedColumn = config.rotationMatrix.map((row) => Number(row[columnName] ?? 0));
    const actualColumn = config.rotationMatrix.map((row) => {
      const jenaRow = jenaRotationRows.get(String(row.codes ?? ""));
      expect(jenaRow, `rotation row for ${String(row.codes)}`).toBeTruthy();
      return jenaRow?.[columnIndex] ?? 0;
    });
    const sign = columnSign(actualColumn, expectedColumn);
    for (let row = 0; row < expectedColumn.length; row += 1) {
      expect((actualColumn[row] ?? 0) * sign, `rotation ${columnName} row ${row}`).toBeCloseTo(expectedColumn[row] ?? 0, 6);
    }
  }
}
