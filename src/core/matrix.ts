import type { AdjacencyKeyEntry, Matrix } from '../types.js';
import { assertFiniteNumbers, assertRectangularMatrix } from './guards.js';

export function cloneMatrix(matrix: Matrix): Matrix {
  return matrix.map((row) => [...row]);
}

export function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}

export function combnC2(n: number): Matrix {
  if (!Number.isInteger(n) || n < 0) throw new Error('n must be a non-negative integer.');
  const out: Matrix = [[], []];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      out[0]?.push(i);
      out[1]?.push(j);
    }
  }
  return out;
}

export function triIndices(length: number, row: -1 | 0 | 1 = -1): Matrix {
  if (!Number.isInteger(length) || length < 0) throw new Error('length must be a non-negative integer.');
  const first: number[] = [];
  const second: number[] = [];
  for (let i = 1; i < length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      first.push(j);
      second.push(i);
    }
  }
  if (row === 0) return [first];
  if (row === 1) return [second];
  return [first, second];
}

export function adjacencyKey(codes: string[]): AdjacencyKeyEntry[] {
  const indices = triIndices(codes.length);
  const sources = indices[0] ?? [];
  const targets = indices[1] ?? [];
  return sources.map((sourceIndex, i) => {
    const targetIndex = targets[i] ?? 0;
    const source = codes[sourceIndex] ?? String(sourceIndex);
    const target = codes[targetIndex] ?? String(targetIndex);
    return {
      source,
      target,
      name: `${source} & ${target}`,
      sourceIndex,
      targetIndex
    } satisfies AdjacencyKeyEntry;
  });
}

export function vectorToUpperTriangle(vector: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < vector.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      out.push((vector[j] ?? 0) * (vector[i] ?? 0));
    }
  }
  return out;
}

export function stringVectorToUpperTriangle(values: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < values.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      out.push(`${values[j] ?? ''} & ${values[i] ?? ''}`);
    }
  }
  return out;
}

export function rowsToCoOccurrences(matrix: Matrix, binary = true): Matrix {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  return matrix.map((row) => {
    const co = vectorToUpperTriangle(row);
    return binary ? co.map((value) => (value > 0 ? 1 : 0)) : co;
  });
}

export function sumColumns(matrix: Matrix): number[] {
  if (matrix.length === 0) return [];
  const width = matrix[0]?.length ?? 0;
  const sums = Array.from({ length: width }, () => 0);
  for (const row of matrix) {
    for (let col = 0; col < width; col += 1) {
      sums[col] = (sums[col] ?? 0) + (row[col] ?? 0);
    }
  }
  return sums;
}

export function meanColumns(matrix: Matrix): number[] {
  if (matrix.length === 0) return [];
  const sums = sumColumns(matrix);
  return sums.map((sum) => sum / matrix.length);
}

export function subtractVectors(a: number[], b: number[]): number[] {
  const length = Math.max(a.length, b.length);
  return Array.from({ length }, (_, i) => (a[i] ?? 0) - (b[i] ?? 0));
}

export function addVectors(a: number[], b: number[]): number[] {
  const length = Math.max(a.length, b.length);
  return Array.from({ length }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
}

export function scaleVector(vector: number[], scalar: number): number[] {
  return vector.map((value) => value * scalar);
}

export function dot(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += (a[i] ?? 0) * (b[i] ?? 0);
  return total;
}

export function l2Norm(vector: number[]): number {
  return Math.sqrt(dot(vector, vector));
}

export function refWindowMatrix(matrix: Matrix, windowSize = 1, windowForward = 0, binary = true): Matrix {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);

  const rowCount = matrix.length;
  const out: Matrix = [];
  const infiniteBack = !Number.isFinite(windowSize);
  const infiniteForward = !Number.isFinite(windowForward);

  for (let row = 0; row < rowCount; row += 1) {
    let earliestRow = 0;
    let lastRow = row;

    if (infiniteBack) {
      earliestRow = 0;
    } else if (windowSize === 0) {
      earliestRow = row;
    } else if (row - (windowSize - 1) >= 0) {
      earliestRow = row - (windowSize - 1);
    }

    if (infiniteForward || row + windowForward >= rowCount) {
      lastRow = rowCount - 1;
    } else if (windowForward > 0 && row + windowForward <= rowCount - 1) {
      lastRow = row + windowForward;
    }

    const currRows = matrix.slice(earliestRow, lastRow + 1);
    let co = vectorToUpperTriangle(sumColumns(currRows));
    const currRowCount = currRows.length;

    if (currRowCount > 0 && windowSize > 1 && row - 1 >= 0) {
      const headRows = Math.max(0, currRowCount - 1 - windowForward);
      if (headRows > 0) {
        co = subtractVectors(co, vectorToUpperTriangle(sumColumns(currRows.slice(0, headRows))));
      }
    }

    if (currRowCount > 0 && windowForward > 0 && lastRow <= rowCount - 1) {
      const tailRowsToUse = lastRow - row;
      if (tailRowsToUse > 0) {
        co = subtractVectors(co, vectorToUpperTriangle(sumColumns(currRows.slice(-tailRowsToUse))));
      }
    }

    out.push(binary ? co.map((value) => (value > 0 ? 1 : 0)) : co);
  }

  return out;
}

export function refWindowLag(matrix: Matrix, windowSize = 0): Matrix {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  const out: Matrix = [];
  for (let row = 0; row < matrix.length; row += 1) {
    const start = Math.max(0, row - (windowSize - 1));
    out.push(sumColumns(matrix.slice(start, row + 1)));
  }
  return out;
}

export function sphereNorm(matrix: Matrix): Matrix {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  return matrix.map((row) => {
    const norm = l2Norm(row);
    return norm > 0 ? row.map((value) => value / norm) : row.map(() => 0);
  });
}

export function skipSphereNorm(matrix: Matrix): Matrix {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  const largest = matrix.reduce((max, row) => Math.max(max, l2Norm(row)), 0);
  if (largest === 0) return matrix.map((row) => row.map(() => 0));
  return matrix.map((row) => row.map((value) => value / largest));
}

export function centerData(matrix: Matrix, centerVector = meanColumns(matrix)): Matrix {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  return matrix.map((row) => row.map((value, columnIndex) => value - (centerVector[columnIndex] ?? 0)));
}

export function transpose(matrix: Matrix): Matrix {
  if (matrix.length === 0) return [];
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const out = zeros(cols, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const outRow = out[col];
      if (outRow) outRow[row] = matrix[row]?.[col] ?? 0;
    }
  }
  return out;
}

export function multiplyMatrices(a: Matrix, b: Matrix): Matrix {
  assertRectangularMatrix(a, 'a');
  assertRectangularMatrix(b, 'b');
  const aRows = a.length;
  const aCols = a[0]?.length ?? 0;
  const bRows = b.length;
  const bCols = b[0]?.length ?? 0;
  if (aCols !== bRows) throw new Error(`Matrix dimensions do not align: ${aRows}x${aCols} times ${bRows}x${bCols}.`);
  const out = zeros(aRows, bCols);
  for (let i = 0; i < aRows; i += 1) {
    for (let j = 0; j < bCols; j += 1) {
      let total = 0;
      for (let k = 0; k < aCols; k += 1) total += (a[i]?.[k] ?? 0) * (b[k]?.[j] ?? 0);
      const outRow = out[i];
      if (outRow) outRow[j] = total;
    }
  }
  return out;
}

export function varianceColumns(matrix: Matrix): number[] {
  if (matrix.length < 2) return (matrix[0] ?? []).map(() => 0);
  const means = meanColumns(matrix);
  const sums = Array.from({ length: means.length }, () => 0);
  for (const row of matrix) {
    for (let col = 0; col < means.length; col += 1) {
      sums[col] = (sums[col] ?? 0) + Math.pow((row[col] ?? 0) - (means[col] ?? 0), 2);
    }
  }
  return sums.map((sum) => sum / (matrix.length - 1));
}

export function pearsonCorrelation(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vectors must have equal length.');
  if (a.length < 2) return Number.NaN;
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? Number.NaN : numerator / denom;
}

export function cohensD(x: number[], y: number[]): number {
  const lx = x.length - 1;
  const ly = y.length - 1;
  if (lx <= 0 || ly <= 0) return Number.NaN;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = (values: number[]) => {
    const m = mean(values);
    return values.reduce((sum, value) => sum + Math.pow(value - m, 2), 0) / (values.length - 1);
  };
  const common = Math.sqrt((lx * variance(x) + ly * variance(y)) / (lx + ly));
  return Math.abs(mean(x) - mean(y)) / common;
}
