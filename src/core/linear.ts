import type { Matrix } from '../types.js';
import { cloneMatrix, identity, multiplyMatrices, transpose, zeros } from './matrix-extra.js';
import { dot, l2Norm, scaleVector, subtractVectors } from './matrix.js';

export interface EigenResult {
  eigenvalues: number[];
  eigenvectors: Matrix; // columns are eigenvectors
}

export function solveLinearSystem(a: Matrix, b: number[], ridge = 1e-10): number[] {
  const n = a.length;
  const aug = a.map((row, i) => row.map((value, j) => value + (i === j ? ridge : 0)).concat(b[i] ?? 0));

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row]?.[col] ?? 0) > Math.abs(aug[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = aug[pivot];
    const currentRow = aug[col];
    if (!pivotRow || !currentRow) throw new Error('Invalid augmented matrix.');
    if (Math.abs(pivotRow[col] ?? 0) < 1e-14) continue;
    aug[pivot] = currentRow;
    aug[col] = pivotRow;

    const divisor = aug[col]?.[col] ?? 1;
    for (let j = col; j <= n; j += 1) {
      const row = aug[col];
      if (row) row[j] = (row[j] ?? 0) / divisor;
    }

    for (let rowIndex = 0; rowIndex < n; rowIndex += 1) {
      if (rowIndex === col) continue;
      const factor = aug[rowIndex]?.[col] ?? 0;
      for (let j = col; j <= n; j += 1) {
        const row = aug[rowIndex];
        if (row) row[j] = (row[j] ?? 0) - factor * (aug[col]?.[j] ?? 0);
      }
    }
  }

  return aug.map((row) => row[n] ?? 0);
}

export function multiplyMatrixVector(matrix: Matrix, vector: number[]): number[] {
  return matrix.map((row) => dot(row, vector));
}

export function normalizeVector(vector: number[]): number[] {
  const norm = l2Norm(vector);
  return norm > 0 ? vector.map((value) => value / norm) : vector.map(() => 0);
}

export function outerProduct(a: number[], b: number[]): Matrix {
  return a.map((left) => b.map((right) => left * right));
}

export function subtractOuterProjection(matrix: Matrix, vector: number[]): Matrix {
  const unit = normalizeVector(vector);
  return matrix.map((row) => {
    const projection = dot(row, unit);
    return subtractVectors(row, scaleVector(unit, projection));
  });
}

export function matrixSubtract(a: Matrix, b: Matrix): Matrix {
  return a.map((row, rowIndex) => row.map((value, colIndex) => value - (b[rowIndex]?.[colIndex] ?? 0)));
}

export function matrixAdd(a: Matrix, b: Matrix): Matrix {
  return a.map((row, rowIndex) => row.map((value, colIndex) => value + (b[rowIndex]?.[colIndex] ?? 0)));
}

export function gramSchmidtComplete(columns: Matrix, dimension: number, tolerance = 1e-10): Matrix {
  const basisColumns: number[][] = [];
  const candidateColumns = [
    ...columns,
    ...Array.from({ length: dimension }, (_unused, index) => Array.from({ length: dimension }, (_u, row) => (row === index ? 1 : 0)))
  ];

  for (const candidate of candidateColumns) {
    let vector = Array.from({ length: dimension }, (_unused, index) => candidate[index] ?? 0);
    for (const basis of basisColumns) {
      vector = subtractVectors(vector, scaleVector(basis, dot(vector, basis)));
    }
    const norm = l2Norm(vector);
    if (norm > tolerance) {
      basisColumns.push(vector.map((value) => value / norm));
    }
    if (basisColumns.length === dimension) break;
  }

  return Array.from({ length: dimension }, (_unused, row) => basisColumns.map((column) => column[row] ?? 0));
}

export function designSolve(design: Matrix, response: Matrix, ridge = 1e-10): Matrix {
  const xt = transpose(design);
  const xtx = multiplyMatrices(xt, design);
  const xty = multiplyMatrices(xt, response);
  const cols = response[0]?.length ?? 0;
  const coefficientsByColumn: Matrix = [];
  for (let col = 0; col < cols; col += 1) {
    coefficientsByColumn.push(solveLinearSystem(xtx, xty.map((row) => row[col] ?? 0), ridge));
  }
  return transpose(coefficientsByColumn);
}

export function symmetricJacobiEigen(input: Matrix, maxIterations = Math.max(200, input.length * input.length * 20), tolerance = 1e-12): EigenResult {
  const n = input.length;
  const a = cloneMatrix(input);
  let v = identity(n);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const value = Math.abs(a[i]?.[j] ?? 0);
        if (value > max) {
          max = value;
          p = i;
          q = j;
        }
      }
    }
    if (max < tolerance || n < 2) break;

    const app = a[p]?.[p] ?? 0;
    const aqq = a[q]?.[q] ?? 0;
    const apq = a[p]?.[q] ?? 0;
    const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(theta);
    const s = Math.sin(theta);

    for (let i = 0; i < n; i += 1) {
      const matrixRow = a[i];
      const aip = matrixRow?.[p] ?? 0;
      const aiq = matrixRow?.[q] ?? 0;
      if (matrixRow) {
        matrixRow[p] = c * aip - s * aiq;
        matrixRow[q] = s * aip + c * aiq;
      }
    }
    const rowP = a[p];
    const rowQ = a[q];
    for (let j = 0; j < n; j += 1) {
      const apj = rowP?.[j] ?? 0;
      const aqj = rowQ?.[j] ?? 0;
      if (rowP) rowP[j] = c * apj - s * aqj;
      if (rowQ) rowQ[j] = s * apj + c * aqj;
    }
    if (rowP) rowP[q] = 0;
    if (rowQ) rowQ[p] = 0;

    const rotation = identity(n);
    const rotationP = rotation[p];
    const rotationQ = rotation[q];
    if (rotationP) {
      rotationP[p] = c;
      rotationP[q] = s;
    }
    if (rotationQ) {
      rotationQ[p] = -s;
      rotationQ[q] = c;
    }
    v = multiplyMatrices(v, rotation);
  }

  const pairs = Array.from({ length: n }, (_, i) => ({ value: a[i]?.[i] ?? 0, index: i }))
    .sort((left, right) => right.value - left.value);
  const eigenvalues = pairs.map((pair) => Math.max(0, pair.value));
  const eigenvectors = Array.from({ length: n }, (_, row) => pairs.map((pair) => v[row]?.[pair.index] ?? 0));

  return { eigenvalues, eigenvectors };
}

export function covarianceLike(matrix: Matrix): Matrix {
  if (matrix.length === 0) return [];
  return multiplyMatrices(transpose(matrix), matrix);
}

export { cloneMatrix, identity, multiplyMatrices, transpose, zeros };
