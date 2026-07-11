import type { AccumulateOptions, ENAData, Matrix, ModelType, Row, WeightBy, WindowType } from './types.js';
import {
  adjacencyKey,
  refWindowLag,
  refWindowMatrix,
  rowsToCoOccurrences,
  stringVectorToUpperTriangle,
  sumColumns,
  toNumericMatrix,
  vectorToUpperTriangle
} from './core/index.js';
import { addMergedColumn, groupBy, mergeColumns, sumRowsBy } from './core/table.js';
import { assertNonEmptyColumns, assertRowsHaveColumns } from './core/guards.js';
import { validateAccumulateOptions } from './core/validate.js';

function normalizeModel(model: ModelType | undefined): ModelType {
  return model ?? 'EndPoint';
}

function normalizeWindow(window: WindowType | undefined): WindowType {
  return window ?? 'MovingStanzaWindow';
}

function normalizeWeightBy(weightBy: WeightBy | undefined): WeightBy {
  return weightBy ?? 'binary';
}

function adjacencyColumnNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `adjacency.code.${index + 1}`);
}

function renameAdjacencyColumns(rows: Row[], fromColumns: string[], toColumns: string[]): Row[] {
  return rows.map((row) => {
    const next: Row = { ...row };
    for (let index = 0; index < fromColumns.length; index += 1) {
      const from = fromColumns[index];
      const to = toColumns[index];
      if (from && to) {
        next[to] = next[from] ?? 0;
        delete next[from];
      }
    }
    return next;
  });
}

function applyMask(matrix: Matrix, mask: Matrix | undefined): Matrix {
  if (!mask) return matrix;
  return matrix.map((row) => row.map((value, index) => {
    const nCodes = mask.length;
    let cursor = 0;
    for (let target = 1; target < nCodes; target += 1) {
      for (let source = 0; source < target; source += 1) {
        if (cursor === index) return value * (mask[source]?.[target] ?? 1);
        cursor += 1;
      }
    }
    return value;
  }));
}

function applyWeightBy(rows: Row[], columns: string[], weightBy: WeightBy): Row[] {
  if (weightBy === 'binary' || weightBy === 'sum') return rows;
  return rows.map((row) => {
    const next: Row = { ...row };
    for (const column of columns) {
      const raw = row[column];
      const value = typeof raw === 'number' ? raw : Number(raw);
      next[column] = weightBy([Number.isFinite(value) ? value : 0]);
    }
    return next;
  });
}

function attachMatrixRows(baseRows: Row[], matrix: Matrix, columns: string[]): Row[] {
  if (baseRows.length !== matrix.length) {
    throw new Error(`Cannot attach ${matrix.length} matrix rows to ${baseRows.length} table rows.`);
  }
  return baseRows.map((row, rowIndex) => {
    const next: Row = { ...row };
    for (let colIndex = 0; colIndex < columns.length; colIndex += 1) {
      next[columns[colIndex] ?? `V${colIndex + 1}`] = matrix[rowIndex]?.[colIndex] ?? 0;
    }
    return next;
  });
}

function buildMetaData(rowsWithUnit: Row[], units: string[], metadata: string[], includeMeta: boolean): Row[] {
  const stableMetadata = includeMeta ? metadata.filter((column) => {
    const valuesByUnit = new Map<string, Set<string>>();
    for (const row of rowsWithUnit) {
      const unit = String(row.ENA_UNIT ?? '');
      const values = valuesByUnit.get(unit) ?? new Set<string>();
      values.add(String(row[column] ?? ''));
      valuesByUnit.set(unit, values);
    }
    return [...valuesByUnit.values()].every((values) => values.size <= 1);
  }) : [];
  const columns = ['ENA_UNIT', ...units, ...stableMetadata];
  const byUnit = new Map<string, Row>();
  for (const row of rowsWithUnit) {
    const unit = String(row.ENA_UNIT ?? '');
    if (!byUnit.has(unit)) {
      byUnit.set(unit, Object.fromEntries(columns.map((column) => [column, row[column] ?? null])) as Row);
    }
  }
  return [...byUnit.values()];
}

function mergeMetaIntoCounts(countRows: Row[], metaRows: Row[], codeColumns: string[]): Row[] {
  const metaByUnit = new Map(metaRows.map((row) => [String(row.ENA_UNIT ?? ''), row]));
  return countRows.map((row) => {
    const meta = metaByUnit.get(String(row.ENA_UNIT ?? '')) ?? {};
    return { ...meta, ...Object.fromEntries(codeColumns.map((column) => [column, row[column] ?? 0])) } as Row;
  });
}

function makeTrajectoryMetaData(countRows: Row[], units: string[]): Row[] {
  return countRows.map((row) => Object.fromEntries([...units, 'ENA_UNIT'].map((column) => [column, row[column] ?? null])) as Row);
}

function makeTrajectoryConnectionCounts(countRows: Row[], units: string[], codeColumns: string[]): Row[] {
  return countRows.map((row) => ({
    ...Object.fromEntries(units.map((column) => [column, row[column] ?? null])),
    ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, units),
    ...Object.fromEntries(codeColumns.map((column) => [column, row[column] ?? 0]))
  }));
}

function numericConnectionMatrix(rows: Row[], columns: string[]): Matrix {
  return rows.map((row) => columns.map((column) => {
    const raw = row[column];
    const value = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(value) ? value : 0;
  }));
}

function makeRowCoOccurrences(
  rowsWithUnit: Row[],
  units: string[],
  conversation: string[],
  codes: string[],
  codeColumns: string[],
  weightBy: WeightBy,
  window: WindowType,
  windowSizeBack: number,
  windowSizeForward: number,
  mask: Matrix | undefined
): Row[] {
  const binary = weightBy === 'binary';
  const adjacencyColumns = adjacencyColumnNames(codeColumns.length);
  let coRows: Row[] = [];

  if (window === 'Conversation') {
    const conversationBy = [...conversation, 'ENA_UNIT'];
    const groups = groupBy(rowsWithUnit, (row) => mergeColumns(row, conversationBy));
    for (const groupRows of groups.values()) {
      const first = groupRows[0];
      if (!first) continue;
      const codeMatrix = toNumericMatrix(groupRows, codes);
      const summed = sumColumns(codeMatrix);
      const co = binary ? vectorToUpperTriangle(summed).map((value) => (value > 0 ? 1 : 0)) : vectorToUpperTriangle(summed);
      coRows.push({
        ...Object.fromEntries(codes.map((code, index) => [code, summed[index] ?? 0])),
        ...Object.fromEntries(conversation.map((column) => [column, first[column] ?? null])),
        ...Object.fromEntries(units.map((column) => [column, first[column] ?? null])),
        ENA_UNIT: first.ENA_UNIT ?? mergeColumns(first, units),
        ...Object.fromEntries(adjacencyColumns.map((column, index) => [column, co[index] ?? 0]))
      });
    }
  } else {
    const groupedIndexes = new Map<string, number[]>();
    rowsWithUnit.forEach((row, index) => {
      const key = mergeColumns(row, conversation);
      const current = groupedIndexes.get(key);
      if (current) current.push(index);
      else groupedIndexes.set(key, [index]);
    });
    const orderedRows: Row[] = Array.from({ length: rowsWithUnit.length }, () => ({}));

    for (const indexes of groupedIndexes.values()) {
      const groupRows = indexes.map((index) => rowsWithUnit[index]).filter((row): row is Row => row !== undefined);
      const codeMatrix = toNumericMatrix(groupRows, codes);
      const coMatrix = windowSizeBack === 1 && windowSizeForward === 0
        ? rowsToCoOccurrences(codeMatrix, binary)
        : refWindowMatrix(codeMatrix, windowSizeBack, windowSizeForward, binary);
      const attachedRows = attachMatrixRows(groupRows, coMatrix, adjacencyColumns);
      indexes.forEach((rowIndex, groupIndex) => {
        orderedRows[rowIndex] = attachedRows[groupIndex] ?? groupRows[groupIndex] ?? {};
      });
    }
    coRows = orderedRows;
  }

  const masked = attachMatrixRows(coRows, applyMask(numericConnectionMatrix(coRows, adjacencyColumns), mask), adjacencyColumns);
  return renameAdjacencyColumns(applyWeightBy(masked, adjacencyColumns, weightBy), adjacencyColumns, codeColumns);
}

function makeEndpointCounts(rowConnections: Row[], units: string[], codeColumns: string[]): Row[] {
  const summed = sumRowsBy(rowConnections, units, codeColumns);
  return summed.map((row) => ({ ...row, ENA_UNIT: mergeColumns(row, units) }));
}

function makeTrajectoryCounts(rowConnections: Row[], units: string[], conversation: string[], codeColumns: string[], model: ModelType): { counts: Row[]; trajectories: Row[] } {
  const trajectoryKey = [...units, ...conversation];
  const perStep: Row[] = sumRowsBy(rowConnections, trajectoryKey, codeColumns).map((row) => ({
    ...row,
    ENA_UNIT: mergeColumns(row, units),
    TRAJ_UNIT: mergeColumns(row, conversation)
  }));

  if (model === 'SeparateTrajectory') {
    return { counts: perStep, trajectories: perStep.map((row) => Object.fromEntries([...units, 'ENA_UNIT', ...conversation].map((column) => [column, row[column] ?? null])) as Row) };
  }

  const grouped = groupBy(perStep, (row) => String(row.ENA_UNIT ?? ''));
  const accumulated: Row[] = [];
  for (const groupRows of grouped.values()) {
    const running = Object.fromEntries(codeColumns.map((column) => [column, 0])) as Row;
    for (const row of groupRows) {
      for (const column of codeColumns) {
        running[column] = Number(running[column] ?? 0) + Number(row[column] ?? 0);
      }
      accumulated.push({ ...row, ...running });
    }
  }
  return { counts: accumulated, trajectories: accumulated.map((row) => Object.fromEntries([...units, 'ENA_UNIT', ...conversation].map((column) => [column, row[column] ?? null])) as Row) };
}

export function accumulateData(options: AccumulateOptions): ENAData {
  validateAccumulateOptions(options);
  const rows = options.rows;
  const units = options.units;
  const conversation = options.conversation;
  const codes = options.codes;
  const metadata = options.metadata ?? [];
  const model = normalizeModel(options.model);
  const weightBy = normalizeWeightBy(options.weightBy);
  const window = normalizeWindow(options.window);
  const windowSizeBack = options.windowSizeBack ?? 1;
  const windowSizeForward = options.windowSizeForward ?? 0;
  const includeMeta = options.includeMeta ?? true;
  const unitsUsed = options.unitsUsed;

  assertNonEmptyColumns(units, 'units');
  assertNonEmptyColumns(conversation, 'conversation');
  assertNonEmptyColumns(codes, 'codes');
  assertRowsHaveColumns(rows, [...units, ...conversation, ...codes, ...metadata]);

  const rawRows = addMergedColumn(rows, 'ENA_UNIT', units);
  const codeColumns = stringVectorToUpperTriangle(codes);
  const rowConnectionCounts = makeRowCoOccurrences(
    rawRows,
    units,
    conversation,
    codes,
    codeColumns,
    weightBy,
    window,
    window === 'Conversation' ? Number.POSITIVE_INFINITY : windowSizeBack,
    windowSizeForward,
    options.mask
  );

  let metaData = buildMetaData(rawRows, units, metadata, includeMeta);
  let countRows: Row[];
  let trajectories: Row[] | undefined;
  let connectionCounts: Row[];
  const unitFilter = unitsUsed ? new Set(unitsUsed.map(String)) : undefined;
  const countedRowConnections = unitFilter
    ? rowConnectionCounts.filter((row) => unitFilter.has(String(row.ENA_UNIT ?? '')))
    : rowConnectionCounts;
  if (unitFilter && countedRowConnections.length === 0) {
    throw new Error('unitsUsed did not match any accumulated units; check the labels against the merged unit column (units joined with ".").');
  }
  if (model === 'EndPoint') {
    countRows = makeEndpointCounts(countedRowConnections, units, codeColumns);
    const countUnits = new Set(countRows.map((row) => String(row.ENA_UNIT ?? '')));
    metaData = metaData.filter((row) => countUnits.has(String(row.ENA_UNIT ?? '')));
    connectionCounts = mergeMetaIntoCounts(countRows, metaData, codeColumns);
  } else {
    const trajectoryResult = makeTrajectoryCounts(countedRowConnections, units, conversation, codeColumns, model);
    countRows = trajectoryResult.counts;
    trajectories = trajectoryResult.trajectories;
    metaData = makeTrajectoryMetaData(countRows, units);
    connectionCounts = makeTrajectoryConnectionCounts(countRows, units, codeColumns);
  }

  const connectionMatrix = numericConnectionMatrix(connectionCounts, codeColumns);
  const unitLabels = countRows.map((row) => model === 'EndPoint'
    ? String(row.ENA_UNIT ?? '')
    : `${String(row.ENA_UNIT ?? '')}::${String(row.TRAJ_UNIT ?? '')}`);

  const result: ENAData = {
    modelType: model,
    codes,
    units,
    conversation,
    codeColumns,
    adjacencyKey: adjacencyKey(codes),
    rawRows,
    rowConnectionCounts,
    connectionCounts,
    connectionMatrix,
    metaData,
    unitLabels,
    functionParams: {
      model,
      weightBy,
      window,
      windowSizeBack,
      windowSizeForward,
      includeMeta,
      ...(unitsUsed ? { unitsUsed } : {})
    }
  };
  if (trajectories) result.trajectories = trajectories;
  return result;
}

export { refWindowLag };
