import type { Matrix, Row, Scalar } from '../types.js';
import { assertRowsHaveColumns } from './guards.js';

export function scalarToString(value: Scalar): string {
  return value === null ? '' : String(value);
}

export function mergeColumns(row: Row, columns: string[], separator = '::'): string {
  return columns.map((column) => scalarToString(row[column] ?? null)).join(separator);
}

function typedScalarIdentity(value: Scalar | undefined): [string, string?] {
  if (value === undefined) return ['undefined'];
  if (value === null) return ['null'];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value ? 'true' : 'false'];
  if (Number.isNaN(value)) return ['number', 'NaN'];
  if (value === Number.POSITIVE_INFINITY) return ['number', 'Infinity'];
  if (value === Number.NEGATIVE_INFINITY) return ['number', '-Infinity'];
  if (Object.is(value, -0)) return ['number', '-0'];
  return ['number', String(value)];
}

/** Collision-free identity for an ordered, typed tuple of Row columns. */
export function typedTupleIdentity(row: Row, columns: string[]): string {
  return JSON.stringify(columns.map((column) => [column, ...typedScalarIdentity(row[column])]));
}

export function addMergedColumn(rows: Row[], outputColumn: string, columns: string[], separator = '::'): Row[] {
  assertRowsHaveColumns(rows, columns);
  return rows.map((row) => ({ ...row, [outputColumn]: mergeColumns(row, columns, separator) }));
}

export function selectColumns(rows: Row[], columns: string[]): Row[] {
  assertRowsHaveColumns(rows, columns);
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])) as Row);
}

export function toNumericMatrix(rows: Row[], columns: string[]): Matrix {
  assertRowsHaveColumns(rows, columns);
  return rows.map((row, rowIndex) => columns.map((column) => {
    const raw = row[column];
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Column ${column} at row ${rowIndex} must be numeric, got ${String(raw)}.`);
    }
    return value;
  }));
}

export function groupBy<RowType extends Row>(rows: RowType[], keyFn: (row: RowType) => string): Map<string, RowType[]> {
  const groups = new Map<string, RowType[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function uniqueRows(rows: Row[], keyColumns: string[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    const key = mergeColumns(row, keyColumns);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(Object.fromEntries(keyColumns.map((column) => [column, row[column] ?? null])) as Row);
    }
  }
  return out;
}

export function numericRowFromColumns(row: Row, columns: string[]): number[] {
  return columns.map((column) => {
    const raw = row[column];
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Column ${column} must be numeric, got ${String(raw)}.`);
    }
    return value;
  });
}

export function rowsWithNumericColumns(rows: Row[], columns: string[], matrix: Matrix): Row[] {
  if (rows.length !== matrix.length) {
    throw new Error(`Row count mismatch: ${rows.length} rows and ${matrix.length} matrix rows.`);
  }
  return rows.map((row, rowIndex) => {
    const next: Row = { ...row };
    columns.forEach((column, columnIndex) => {
      next[column] = matrix[rowIndex]?.[columnIndex] ?? 0;
    });
    return next;
  });
}

export function sumRowsBy(rows: Row[], keyColumns: string[], valueColumns: string[]): Row[] {
  const grouped = groupBy(rows, (row) => mergeColumns(row, keyColumns));
  const out: Row[] = [];
  for (const groupRows of grouped.values()) {
    const first = groupRows[0];
    if (!first) continue;
    const next: Row = Object.fromEntries(keyColumns.map((column) => [column, first[column] ?? null])) as Row;
    for (const column of valueColumns) {
      next[column] = groupRows.reduce((sum, row) => {
        const raw = row[column];
        const value = typeof raw === 'number' ? raw : Number(raw);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
    }
    out.push(next);
  }
  return out;
}
