import type { Matrix, Row } from '../types.js';

export function assertNonEmptyColumns(columns: string[], label: string): void {
  if (columns.length === 0) {
    throw new Error(`${label} must contain at least one column name.`);
  }
}

export function assertRowsHaveColumns(rows: Row[], columns: string[], label = 'rows'): void {
  const missing = new Set<string>();
  for (const row of rows) {
    for (const column of columns) {
      if (!(column in row)) missing.add(column);
    }
  }
  if (missing.size > 0) {
    throw new Error(`${label} are missing required columns: ${[...missing].join(', ')}`);
  }
}

export function assertRectangularMatrix(matrix: Matrix, label = 'matrix'): void {
  if (matrix.length === 0) return;
  const width = matrix[0]?.length ?? 0;
  for (let i = 0; i < matrix.length; i += 1) {
    if ((matrix[i]?.length ?? 0) !== width) {
      throw new Error(`${label} must be rectangular; row ${i} has a different width.`);
    }
  }
}

export function assertFiniteNumbers(matrix: Matrix, label = 'matrix'): void {
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < (matrix[row]?.length ?? 0); col += 1) {
      const value = matrix[row]?.[col];
      if (typeof value !== 'number' || Number.isNaN(value)) {
        throw new Error(`${label}[${row}][${col}] must be a number, got ${String(value)}.`);
      }
    }
  }
}
