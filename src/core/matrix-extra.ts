import type { Matrix } from '../types.js';

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_unused, col) => (row === col ? 1 : 0)));
}

export { cloneMatrix, multiplyMatrices, transpose, zeros } from './matrix.js';
