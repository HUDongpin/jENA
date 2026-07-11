/*
 * Derived from rENA 0.3.1 (GPL-3), (c) the rENA authors: Cody L Marquart,
 * Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and
 * David Williamson Shaffer. This file is a streaming re-implementation of
 * the rENA window/accumulation semantics in src/ena.cpp.
 * TypeScript translation and modifications for jena-js, GPL-3.0-only.
 * See PROVENANCE.md for the upstream NOTICE and version pin.
 */
import type { AccumulateOptions, ENAData, Matrix, ModelType, Row, Scalar, WeightBy, WindowType } from './types.js';
import {
  adjacencyKey,
  stringVectorToUpperTriangle,
  sumColumns,
  vectorToUpperTriangle
} from './core/index.js';
import { assertNonEmptyColumns, assertRowsHaveColumns } from './core/guards.js';
import { mergeColumns } from './core/table.js';
import { validateAccumulateOptions } from './core/validate.js';

export interface NumericTable {
  data: Float64Array;
  rows: number;
  cols: number;
}

export type StreamingMaterialization = 'full' | 'model';

export interface ChunkedAccumulateOptions extends AccumulateOptions {
  chunkSize?: number;
  onProgress?: (progress: number) => void;
  materialization?: StreamingMaterialization;
}

export interface StreamingAccumulateOptions extends Omit<AccumulateOptions, 'rows'> {
  rows?: Row[];
  chunkSize?: number;
  expectedRows?: number;
  materialization?: StreamingMaterialization;
  onProgress?: (progress: number, state: AccumulationChunkState) => void;
}

export interface AccumulationChunkState {
  rowsSeen: number;
  chunksSeen: number;
  isFinished: boolean;
  progress: number;
  activeConversations: number;
  activeBufferedRows: number;
  activeConversationsPeak: number;
  activeBufferedRowsPeak: number;
}

export interface AccumulationStream {
  readonly state: AccumulationChunkState;
  push(rows: Row[]): AccumulationChunkState;
  finish(): ENAData;
  reset(): void;
}

interface StreamRowEntry {
  globalIndex: number;
  localIndex: number;
  row: Row;
  codeValues: number[];
}

interface MovingConversationState {
  key: string;
  rowsSeen: number;
  nextEmitLocalIndex: number;
  bufferOffset: number;
  buffer: StreamRowEntry[];
  noForwardHistory: number[][];
  noForwardRunningSum: number[];
}

interface ConversationAggregate {
  key: string;
  row: Row;
  sums: number[];
  sequence: number;
}

interface CountAccumulator {
  row: Row;
  sums: number[];
  sequence: number;
}

interface MetadataState {
  row: Row;
  values: Map<string, Scalar>;
  unstable: Set<string>;
  sequence: number;
}

interface StreamingInternals {
  model: ModelType;
  window: WindowType;
  weightBy: WeightBy;
  windowSizeBack: number;
  windowSizeForward: number;
  includeMeta: boolean;
  materialization: StreamingMaterialization;
  units: string[];
  conversation: string[];
  codes: string[];
  metadata: string[];
  codeColumns: string[];
  mask?: Matrix;
  unitFilter?: Set<string>;
  rawRows: Row[];
  rowConnectionRows: Array<{ index: number; row: Row }>;
  movingConversations: Map<string, MovingConversationState>;
  conversationAggregates: Map<string, ConversationAggregate>;
  conversationAggregateOrder: string[];
  endpointCounts: Map<string, CountAccumulator>;
  endpointOrder: string[];
  stepCounts: Map<string, CountAccumulator>;
  stepOrder: string[];
  metadataStates: Map<string, MetadataState>;
  metadataOrder: string[];
  rowConnectionSequence: number;
}

export function rowsToNumericTable(rows: Row[], columns: string[]): NumericTable {
  const data = new Float64Array(rows.length * columns.length);
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < columns.length; col += 1) {
      const raw = rows[row]?.[columns[col] ?? ''];
      const value = typeof raw === 'number' ? raw : Number(raw);
      data[row * columns.length + col] = Number.isFinite(value) ? value : 0;
    }
  }
  return { data, rows: rows.length, cols: columns.length };
}

export function rowsToCoOccurrencesTyped(table: NumericTable, binary = true): NumericTable {
  const outCols = (table.cols * (table.cols - 1)) / 2;
  const out = new Float64Array(table.rows * outCols);
  for (let row = 0; row < table.rows; row += 1) {
    let cursor = 0;
    for (let target = 1; target < table.cols; target += 1) {
      for (let source = 0; source < target; source += 1) {
        const value = (table.data[row * table.cols + source] ?? 0) * (table.data[row * table.cols + target] ?? 0);
        out[row * outCols + cursor] = binary ? (value > 0 ? 1 : 0) : value;
        cursor += 1;
      }
    }
  }
  return { data: out, rows: table.rows, cols: outCols };
}

function normalizeModel(model: ModelType | undefined): ModelType {
  return model ?? 'EndPoint';
}

function normalizeWindow(window: WindowType | undefined): WindowType {
  return window ?? 'MovingStanzaWindow';
}

function normalizeWeightBy(weightBy: WeightBy | undefined): WeightBy {
  return weightBy ?? 'binary';
}

function numeric(row: Row, column: string): number {
  const raw = row[column];
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function zeros(length: number): number[] {
  return Array.from({ length }, () => 0);
}

function addVectors(left: number[], right: number[]): number[] {
  const width = Math.max(left.length, right.length);
  return Array.from({ length: width }, (_unused, index) => (left[index] ?? 0) + (right[index] ?? 0));
}

function subtractVectors(left: number[], right: number[]): number[] {
  const width = Math.max(left.length, right.length);
  return Array.from({ length: width }, (_unused, index) => (left[index] ?? 0) - (right[index] ?? 0));
}

function sumCodeVectors(vectors: number[][], width: number): number[] {
  if (vectors.length === 0) return zeros(width);
  return sumColumns(vectors);
}

function codeValues(row: Row, codes: string[]): number[] {
  return codes.map((code) => numeric(row, code));
}

function makeUnitRow(row: Row, units: string[]): Row {
  return { ...row, ENA_UNIT: mergeColumns(row, units) };
}

function applyMaskToCoOccurrence(values: number[], mask: Matrix | undefined): number[] {
  if (!mask) return values;
  return values.map((value, index) => {
    let cursor = 0;
    for (let target = 1; target < mask.length; target += 1) {
      for (let source = 0; source < target; source += 1) {
        if (cursor === index) return value * (mask[source]?.[target] ?? 1);
        cursor += 1;
      }
    }
    return value;
  });
}

function applyWeight(values: number[], weightBy: WeightBy): number[] {
  if (weightBy === 'binary' || weightBy === 'sum') return values;
  return values.map((value) => weightBy([value]));
}

function coOccurrenceFromSums(total: number[], subtract: number[] | undefined, binary: boolean): number[] {
  const co = subtract ? subtractVectors(vectorToUpperTriangle(total), vectorToUpperTriangle(subtract)) : vectorToUpperTriangle(total);
  return binary ? co.map((value) => (value > 0 ? 1 : 0)) : co;
}

function finalizeCoOccurrence(values: number[], internals: StreamingInternals): number[] {
  return applyWeight(applyMaskToCoOccurrence(values, internals.mask), internals.weightBy);
}

function rowWithCoOccurrences(base: Row, co: number[], codeColumns: string[]): Row {
  return {
    ...base,
    ...Object.fromEntries(codeColumns.map((column, index) => [column, co[index] ?? 0]))
  };
}

function ensureMetadata(internals: StreamingInternals, row: Row, sequence: number): void {
  if (!internals.includeMeta) return;
  const unit = String(row.ENA_UNIT ?? '');
  let state = internals.metadataStates.get(unit);
  if (!state) {
    state = {
      row: Object.fromEntries(['ENA_UNIT', ...internals.units].map((column) => [column, row[column] ?? null])) as Row,
      values: new Map(),
      unstable: new Set(),
      sequence
    };
    for (const column of internals.metadata) state.values.set(column, row[column] ?? null);
    internals.metadataStates.set(unit, state);
    internals.metadataOrder.push(unit);
    return;
  }
  for (const column of internals.metadata) {
    const previous = state.values.get(column);
    const current = row[column] ?? null;
    if (String(previous ?? '') !== String(current ?? '')) state.unstable.add(column);
  }
}

function ensureEndpointCount(internals: StreamingInternals, row: Row, sequence: number): CountAccumulator {
  const key = String(row.ENA_UNIT ?? mergeColumns(row, internals.units));
  let accumulator = internals.endpointCounts.get(key);
  if (!accumulator) {
    accumulator = {
      row: {
        ...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
        ENA_UNIT: key
      },
      sums: zeros(internals.codeColumns.length),
      sequence
    };
    internals.endpointCounts.set(key, accumulator);
    internals.endpointOrder.push(key);
  }
  return accumulator;
}

function ensureStepCount(internals: StreamingInternals, row: Row, sequence: number): CountAccumulator {
  const key = mergeColumns(row, [...internals.units, ...internals.conversation]);
  let accumulator = internals.stepCounts.get(key);
  if (!accumulator) {
    accumulator = {
      row: {
        ...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
        ...Object.fromEntries(internals.conversation.map((column) => [column, row[column] ?? null])),
        ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units),
        TRAJ_UNIT: mergeColumns(row, internals.conversation)
      },
      sums: zeros(internals.codeColumns.length),
      sequence
    };
    internals.stepCounts.set(key, accumulator);
    internals.stepOrder.push(key);
  }
  return accumulator;
}

function addToAccumulator(accumulator: CountAccumulator, values: number[]): void {
  for (let index = 0; index < values.length; index += 1) {
    accumulator.sums[index] = (accumulator.sums[index] ?? 0) + (values[index] ?? 0);
  }
}

// Registers the unit/step accumulator when its first raw row ARRIVES, so
// aggregation order matches batch accumulation (first appearance in row
// order, like rENA). Forward windows delay consumption of a conversation's
// trailing rows until flush, which would otherwise reorder units.
function registerCountAccumulator(internals: StreamingInternals, row: Row, sequence: number): void {
  const unit = String(row.ENA_UNIT ?? '');
  if (internals.unitFilter && !internals.unitFilter.has(unit)) return;
  if (internals.model === 'EndPoint') ensureEndpointCount(internals, row, sequence);
  else ensureStepCount(internals, row, sequence);
}

function consumeRowConnection(internals: StreamingInternals, index: number, row: Row): void {
  if (internals.materialization === 'full') internals.rowConnectionRows.push({ index, row });
  const unit = String(row.ENA_UNIT ?? '');
  if (internals.unitFilter && !internals.unitFilter.has(unit)) return;
  const values = internals.codeColumns.map((column) => numeric(row, column));
  if (internals.model === 'EndPoint') {
    addToAccumulator(ensureEndpointCount(internals, row, index), values);
  } else {
    addToAccumulator(ensureStepCount(internals, row, index), values);
  }
}

function makeNoForwardCoOccurrence(state: MovingConversationState, entry: StreamRowEntry, internals: StreamingInternals): number[] {
  const binary = internals.weightBy === 'binary';
  const back = internals.windowSizeBack;
  if (back === 0 || back === 1) return coOccurrenceFromSums(entry.codeValues, undefined, binary);
  if (!Number.isFinite(back)) {
    const previous = state.noForwardRunningSum;
    const total = addVectors(previous, entry.codeValues);
    state.noForwardRunningSum = total;
    return coOccurrenceFromSums(total, previous, binary);
  }
  const previousRows = state.noForwardHistory.slice(-Math.max(0, back - 1));
  const previous = sumCodeVectors(previousRows, internals.codes.length);
  state.noForwardHistory.push(entry.codeValues);
  while (state.noForwardHistory.length > back - 1) state.noForwardHistory.shift();
  return coOccurrenceFromSums(addVectors(previous, entry.codeValues), previous, binary);
}

function rowsForLocalRange(state: MovingConversationState, earliest: number, last: number): number[][] {
  return state.buffer
    .filter((entry) => entry.localIndex >= earliest && entry.localIndex <= last)
    .sort((left, right) => left.localIndex - right.localIndex)
    .map((entry) => entry.codeValues);
}

function computeWindowCoOccurrence(state: MovingConversationState, rowIndex: number, final: boolean, internals: StreamingInternals): number[] | undefined {
  const rowCount = state.rowsSeen;
  const back = internals.windowSizeBack;
  const forward = internals.windowSizeForward;
  const binary = internals.weightBy === 'binary';
  const infiniteBack = !Number.isFinite(back);
  const infiniteForward = !Number.isFinite(forward);
  if (!final && (infiniteForward || rowIndex + forward >= rowCount)) return undefined;

  let earliest = 0;
  let last = rowIndex;
  if (infiniteBack) earliest = 0;
  else if (back === 0) earliest = rowIndex;
  else if (rowIndex - (back - 1) >= 0) earliest = rowIndex - (back - 1);

  if (infiniteForward || rowIndex + forward >= rowCount) last = rowCount - 1;
  else if (forward > 0 && rowIndex + forward <= rowCount - 1) last = rowIndex + forward;

  const currRows = rowsForLocalRange(state, earliest, last);
  if (currRows.length !== last - earliest + 1) return undefined;
  let co = vectorToUpperTriangle(sumCodeVectors(currRows, internals.codes.length));
  const currRowCount = currRows.length;
  if (currRowCount > 0 && back > 1 && rowIndex - 1 >= 0) {
    const headRows = currRowCount - 1 - forward;
    if (headRows > 0) {
      co = subtractVectors(co, vectorToUpperTriangle(sumCodeVectors(currRows.slice(0, headRows), internals.codes.length)));
    }
  }
  if (currRowCount > 0 && forward > 0 && last <= rowCount - 1) {
    const tailRowsToUse = last - rowIndex;
    if (tailRowsToUse > 0) {
      co = subtractVectors(co, vectorToUpperTriangle(sumCodeVectors(currRows.slice(-tailRowsToUse), internals.codes.length)));
    }
  }
  return binary ? co.map((value) => (value > 0 ? 1 : 0)) : co;
}

function emitReadyRows(state: MovingConversationState, final: boolean, internals: StreamingInternals): void {
  while (state.nextEmitLocalIndex < state.rowsSeen) {
    const entry = state.buffer.find((candidate) => candidate.localIndex === state.nextEmitLocalIndex);
    if (!entry) break;
    const co = computeWindowCoOccurrence(state, state.nextEmitLocalIndex, final, internals);
    if (!co) break;
    consumeRowConnection(
      internals,
      entry.globalIndex,
      rowWithCoOccurrences(entry.row, finalizeCoOccurrence(co, internals), internals.codeColumns)
    );
    state.nextEmitLocalIndex += 1;
  }

  if (Number.isFinite(internals.windowSizeBack)) {
    const keepFrom = Math.max(0, state.nextEmitLocalIndex - Math.max(0, internals.windowSizeBack - 1));
    while (state.buffer.length > 0 && (state.buffer[0]?.localIndex ?? 0) < keepFrom) {
      state.buffer.shift();
      state.bufferOffset = keepFrom;
    }
  }
}

function getMovingConversation(internals: StreamingInternals, key: string): MovingConversationState {
  let state = internals.movingConversations.get(key);
  if (!state) {
    state = {
      key,
      rowsSeen: 0,
      nextEmitLocalIndex: 0,
      bufferOffset: 0,
      buffer: [],
      noForwardHistory: [],
      noForwardRunningSum: zeros(internals.codes.length)
    };
    internals.movingConversations.set(key, state);
  }
  return state;
}

function pushMovingRow(internals: StreamingInternals, row: Row, globalIndex: number): void {
  const key = mergeColumns(row, internals.conversation);
  const state = getMovingConversation(internals, key);
  const entry: StreamRowEntry = {
    globalIndex,
    localIndex: state.rowsSeen,
    row,
    codeValues: codeValues(row, internals.codes)
  };
  state.rowsSeen += 1;

  if (internals.windowSizeForward === 0) {
    const co = makeNoForwardCoOccurrence(state, entry, internals);
    consumeRowConnection(
      internals,
      globalIndex,
      rowWithCoOccurrences(row, finalizeCoOccurrence(co, internals), internals.codeColumns)
    );
    return;
  }

  state.buffer.push(entry);
  emitReadyRows(state, false, internals);
}

function pushConversationRow(internals: StreamingInternals, row: Row, sequence: number): void {
  const key = mergeColumns(row, [...internals.conversation, 'ENA_UNIT']);
  let aggregate = internals.conversationAggregates.get(key);
  if (!aggregate) {
    aggregate = {
      key,
      row: {
        ...Object.fromEntries(internals.codes.map((code) => [code, 0])),
        ...Object.fromEntries(internals.conversation.map((column) => [column, row[column] ?? null])),
        ...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
        ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units)
      },
      sums: zeros(internals.codes.length),
      sequence
    };
    internals.conversationAggregates.set(key, aggregate);
    internals.conversationAggregateOrder.push(key);
  }
  for (let index = 0; index < internals.codes.length; index += 1) {
    aggregate.sums[index] = (aggregate.sums[index] ?? 0) + numeric(row, internals.codes[index] ?? '');
  }
}

function flushConversationWindow(internals: StreamingInternals): void {
  const binary = internals.weightBy === 'binary';
  for (const key of internals.conversationAggregateOrder) {
    const aggregate = internals.conversationAggregates.get(key);
    if (!aggregate) continue;
    const co = coOccurrenceFromSums(aggregate.sums, undefined, binary);
    const row = {
      ...aggregate.row,
      ...Object.fromEntries(internals.codes.map((code, index) => [code, aggregate.sums[index] ?? 0]))
    };
    consumeRowConnection(
      internals,
      aggregate.sequence,
      rowWithCoOccurrences(row, finalizeCoOccurrence(co, internals), internals.codeColumns)
    );
  }
}

function stableMetadataColumns(internals: StreamingInternals): string[] {
  if (!internals.includeMeta) return [];
  return internals.metadata.filter((column) => {
    for (const state of internals.metadataStates.values()) {
      if (state.unstable.has(column)) return false;
    }
    return true;
  });
}

function buildMetadataRows(internals: StreamingInternals, countUnits: Set<string>): Row[] {
  const stable = stableMetadataColumns(internals);
  return internals.metadataOrder
    .filter((unit) => countUnits.has(unit))
    .map((unit) => {
      const state = internals.metadataStates.get(unit);
      const base = state?.row ?? { ENA_UNIT: unit };
      return {
        ...base,
        ...Object.fromEntries(stable.map((column) => [column, state?.values.get(column) ?? null]))
      } as Row;
    });
}

function matrixFromRows(rows: Row[], columns: string[]): Matrix {
  return rows.map((row) => columns.map((column) => numeric(row, column)));
}

function makeEndpointResult(internals: StreamingInternals): { connectionCounts: Row[]; metaData: Row[]; countRows: Row[] } {
  const countRows = internals.endpointOrder.map((key) => {
    const accumulator = internals.endpointCounts.get(key);
    return {
      ...(accumulator?.row ?? { ENA_UNIT: key }),
      ...Object.fromEntries(internals.codeColumns.map((column, index) => [column, accumulator?.sums[index] ?? 0]))
    } as Row;
  });
  const countUnits = new Set(countRows.map((row) => String(row.ENA_UNIT ?? '')));
  const metaData = buildMetadataRows(internals, countUnits);
  const metaByUnit = new Map(metaData.map((row) => [String(row.ENA_UNIT ?? ''), row]));
  return {
    countRows,
    metaData,
    connectionCounts: countRows.map((row) => ({
      ...(metaByUnit.get(String(row.ENA_UNIT ?? '')) ?? {}),
      ...Object.fromEntries(internals.codeColumns.map((column) => [column, row[column] ?? 0]))
    }) as Row)
  };
}

function makeTrajectoryRows(internals: StreamingInternals): Row[] {
  return internals.stepOrder.map((key) => {
    const accumulator = internals.stepCounts.get(key);
    return {
      ...(accumulator?.row ?? {}),
      ...Object.fromEntries(internals.codeColumns.map((column, index) => [column, accumulator?.sums[index] ?? 0]))
    } as Row;
  });
}

function makeTrajectoryResult(internals: StreamingInternals): { connectionCounts: Row[]; metaData: Row[]; countRows: Row[]; trajectories: Row[] } {
  const perStepRows = makeTrajectoryRows(internals);
  const countRows: Row[] = [];
  if (internals.model === 'SeparateTrajectory') {
    countRows.push(...perStepRows);
  } else {
    const rowsByUnit = new Map<string, Row[]>();
    for (const row of perStepRows) {
      const unit = String(row.ENA_UNIT ?? '');
      const current = rowsByUnit.get(unit);
      if (current) current.push(row);
      else rowsByUnit.set(unit, [row]);
    }
    for (const groupRows of rowsByUnit.values()) {
      const running = Object.fromEntries(internals.codeColumns.map((column) => [column, 0])) as Row;
      for (const row of groupRows) {
        for (const column of internals.codeColumns) running[column] = numeric(running, column) + numeric(row, column);
        countRows.push({ ...row, ...running });
      }
    }
  }
  const trajectories = countRows.map((row) => Object.fromEntries([...internals.units, 'ENA_UNIT', ...internals.conversation].map((column) => [column, row[column] ?? null])) as Row);
  const metaData = countRows.map((row) => Object.fromEntries([...internals.units, 'ENA_UNIT'].map((column) => [column, row[column] ?? null])) as Row);
  const connectionCounts = countRows.map((row) => ({
    ...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
    ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units),
    ...Object.fromEntries(internals.codeColumns.map((column) => [column, row[column] ?? 0]))
  }) as Row);
  return { connectionCounts, metaData, countRows, trajectories };
}

function flushMovingWindow(internals: StreamingInternals): void {
  if (internals.windowSizeForward === 0) return;
  for (const state of internals.movingConversations.values()) emitReadyRows(state, true, internals);
}

function finishInternals(internals: StreamingInternals): ENAData {
  if (internals.window === 'Conversation') flushConversationWindow(internals);
  else flushMovingWindow(internals);

  const resultRows = internals.model === 'EndPoint'
    ? makeEndpointResult(internals)
    : makeTrajectoryResult(internals);
  const connectionMatrix = matrixFromRows(resultRows.connectionCounts, internals.codeColumns);
  const unitLabels = resultRows.countRows.map((row) => internals.model === 'EndPoint'
    ? String(row.ENA_UNIT ?? '')
    : `${String(row.ENA_UNIT ?? '')}::${String(row.TRAJ_UNIT ?? '')}`);
  const rowConnectionCounts = internals.materialization === 'full'
    ? internals.rowConnectionRows.sort((left, right) => left.index - right.index).map((entry) => entry.row)
    : [];
  const rawRows = internals.materialization === 'full' ? internals.rawRows : [];

  const result: ENAData = {
    modelType: internals.model,
    codes: internals.codes,
    units: internals.units,
    conversation: internals.conversation,
    codeColumns: internals.codeColumns,
    adjacencyKey: adjacencyKey(internals.codes),
    rawRows,
    rowConnectionCounts,
    connectionCounts: resultRows.connectionCounts,
    connectionMatrix,
    metaData: resultRows.metaData,
    unitLabels,
    functionParams: {
      model: internals.model,
      weightBy: internals.weightBy,
      window: internals.window,
      windowSizeBack: internals.windowSizeBack,
      windowSizeForward: internals.windowSizeForward,
      includeMeta: internals.includeMeta,
      ...(internals.unitFilter ? { unitsUsed: [...internals.unitFilter] } : {})
    }
  };
  const trajectoryRows = (resultRows as { trajectories?: Row[] }).trajectories;
  if (trajectoryRows) result.trajectories = trajectoryRows;
  return result;
}

function activeBufferedRows(internals: StreamingInternals): number {
  let total = 0;
  for (const state of internals.movingConversations.values()) {
    total += state.buffer.length + state.noForwardHistory.length;
  }
  return total;
}

function updateProgress(state: AccumulationChunkState, internals: StreamingInternals, expectedRows: number | undefined): void {
  state.progress = expectedRows && expectedRows > 0 ? Math.min(0.99, state.rowsSeen / expectedRows) : 0;
  state.activeConversations = internals.movingConversations.size + internals.conversationAggregates.size;
  state.activeBufferedRows = activeBufferedRows(internals);
  state.activeConversationsPeak = Math.max(state.activeConversationsPeak, state.activeConversations);
  state.activeBufferedRowsPeak = Math.max(state.activeBufferedRowsPeak, state.activeBufferedRows);
}

function makeInternals(options: StreamingAccumulateOptions): StreamingInternals {
  const model = normalizeModel(options.model);
  const window = normalizeWindow(options.window);
  const weightBy = normalizeWeightBy(options.weightBy);
  const metadata = options.metadata ?? [];
  assertNonEmptyColumns(options.units, 'units');
  assertNonEmptyColumns(options.conversation, 'conversation');
  assertNonEmptyColumns(options.codes, 'codes');
  if (options.rows) assertRowsHaveColumns(options.rows, [...options.units, ...options.conversation, ...options.codes, ...metadata]);
  return {
    model,
    window,
    weightBy,
    windowSizeBack: window === 'Conversation' ? Number.POSITIVE_INFINITY : options.windowSizeBack ?? 1,
    windowSizeForward: options.windowSizeForward ?? 0,
    includeMeta: options.includeMeta ?? true,
    materialization: options.materialization ?? 'full',
    units: options.units,
    conversation: options.conversation,
    codes: options.codes,
    metadata,
    codeColumns: stringVectorToUpperTriangle(options.codes),
    ...(options.mask ? { mask: options.mask } : {}),
    ...(options.unitsUsed ? { unitFilter: new Set(options.unitsUsed.map(String)) } : {}),
    rawRows: [],
    rowConnectionRows: [],
    movingConversations: new Map(),
    conversationAggregates: new Map(),
    conversationAggregateOrder: [],
    endpointCounts: new Map(),
    endpointOrder: [],
    stepCounts: new Map(),
    stepOrder: [],
    metadataStates: new Map(),
    metadataOrder: [],
    rowConnectionSequence: 0
  };
}

function ingestRow(internals: StreamingInternals, row: Row, globalIndex: number): void {
  const rowWithUnit = makeUnitRow(row, internals.units);
  if (internals.materialization === 'full') internals.rawRows.push(rowWithUnit);
  ensureMetadata(internals, rowWithUnit, globalIndex);
  registerCountAccumulator(internals, rowWithUnit, globalIndex);
  if (internals.window === 'Conversation') pushConversationRow(internals, rowWithUnit, internals.rowConnectionSequence);
  else pushMovingRow(internals, rowWithUnit, globalIndex);
  internals.rowConnectionSequence += 1;
}

export function accumulateDataChunked(options: ChunkedAccumulateOptions): ENAData {
  const chunkSize = options.chunkSize ?? 10_000;
  if (chunkSize <= 0 || !Number.isFinite(chunkSize)) throw new Error('chunkSize must be a positive finite number.');
  options.onProgress?.(0);
  const stream = createAccumulationStream({
    ...options,
    rows: [],
    expectedRows: options.rows.length,
    onProgress: (progress) => options.onProgress?.(progress)
  });
  for (let index = 0; index < options.rows.length; index += chunkSize) {
    stream.push(options.rows.slice(index, index + chunkSize));
  }
  const result = stream.finish();
  options.onProgress?.(1);
  return result;
}

export function createAccumulationStream(options: StreamingAccumulateOptions): AccumulationStream {
  const { rows: initialRows, chunkSize = 10_000, expectedRows, onProgress } = options;
  if (chunkSize <= 0 || !Number.isFinite(chunkSize)) throw new Error('chunkSize must be a positive finite number.');
  validateAccumulateOptions(options, { requireRows: false });
  const internals = makeInternals(options);
  const state: AccumulationChunkState = {
    rowsSeen: 0,
    chunksSeen: 0,
    isFinished: false,
    progress: 0,
    activeConversations: 0,
    activeBufferedRows: 0,
    activeConversationsPeak: 0,
    activeBufferedRowsPeak: 0
  };

  const push = (rows: Row[]): AccumulationChunkState => {
    if (state.isFinished) throw new Error('Cannot push rows after accumulation stream has finished.');
    assertRowsHaveColumns(rows, [...options.units, ...options.conversation, ...options.codes, ...(options.metadata ?? [])]);
    for (const row of rows) {
      ingestRow(internals, row, state.rowsSeen);
      state.rowsSeen += 1;
    }
    state.chunksSeen += 1;
    updateProgress(state, internals, expectedRows);
    onProgress?.(state.progress, { ...state });
    return { ...state };
  };

  if (initialRows && initialRows.length > 0) {
    for (let index = 0; index < initialRows.length; index += chunkSize) push(initialRows.slice(index, index + chunkSize));
  }

  return {
    state,
    push,
    finish(): ENAData {
      if (state.isFinished) throw new Error('Accumulation stream has already finished.');
      state.isFinished = true;
      const result = finishInternals(internals);
      state.progress = 1;
      updateProgress(state, internals, expectedRows);
      state.progress = 1;
      onProgress?.(1, { ...state });
      return result;
    },
    reset(): void {
      throw new Error('Reset is not supported for incremental accumulation streams. Create a new stream instead.');
    }
  };
}

export function accumulateDataStreaming(options: StreamingAccumulateOptions): ENAData {
  const stream = createAccumulationStream(options);
  return stream.finish();
}
