import type { AccumulateOptions, ENAData, MakeSetOptions, Matrix, WeightBy } from '../types.js';
import { adjacencyKey, orderedAdjacencyKey } from './matrix.js';

// Boundary validation for the public entry points (advisory F-011). Every
// rejection names the offending option and how to fix it, so malformed input
// fails loudly instead of producing quietly wrong numbers.

const MODELS = new Set(['EndPoint', 'AccumulatedTrajectory', 'SeparateTrajectory']);
const WINDOWS = new Set(['MovingStanzaWindow', 'Conversation']);
const NETWORK_TYPES = new Set(['standard', 'ordered']);
const ROTATION_METHODS = new Set(['svd', 'mean', 'generalized', 'regression', 'regression2', 'hena', 'spherical']);
const NODE_POSITION_METHODS = new Set(['undirected', 'directed', 'directed-ground-response']);

function isWindowSize(value: number): boolean {
  return value === Number.POSITIVE_INFINITY || (Number.isInteger(value) && value >= 0);
}

function firstDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function validateMask(mask: Matrix, codeCount: number, ordered = false): void {
  if (!Array.isArray(mask) || mask.length !== codeCount) {
    throw new Error(`mask must be a ${codeCount}x${codeCount} matrix matching codes.length; got ${Array.isArray(mask) ? mask.length : typeof mask} rows.`);
  }
  for (let row = 0; row < mask.length; row += 1) {
    const maskRow = mask[row];
    if (!Array.isArray(maskRow) || maskRow.length !== codeCount) {
      throw new Error(`mask row ${row} must have ${codeCount} columns matching codes.length; got ${Array.isArray(maskRow) ? maskRow.length : typeof maskRow}.`);
    }
    for (let col = 0; col < maskRow.length; col += 1) {
      const value = maskRow[col];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`mask[${row}][${col}] must be a finite number; got ${String(value)}.`);
      }
      if (ordered && value < 0) {
        throw new Error(`Ordered network analysis mask[${row}][${col}] must be non-negative; got ${String(value)}.`);
      }
    }
  }
}

export interface ValidateAccumulateOptions {
  requireRows?: boolean;
}

export function validateAccumulateOptions(
  options: Omit<AccumulateOptions, 'rows'> & { rows?: AccumulateOptions['rows'] },
  { requireRows = true }: ValidateAccumulateOptions = {}
): void {
  if (requireRows && (!Array.isArray(options.rows) || options.rows.length === 0)) {
    throw new Error('rows is empty; provide at least one coded data row.');
  }
  if (!Array.isArray(options.codes) || options.codes.length < 2) {
    throw new Error(`codes must list at least 2 code columns to model co-occurrences; got ${Array.isArray(options.codes) ? options.codes.length : typeof options.codes}.`);
  }
  const duplicateCode = firstDuplicate(options.codes);
  if (duplicateCode !== undefined) {
    throw new Error(`codes must contain unique column labels; duplicate "${duplicateCode}".`);
  }
  if (options.networkType !== undefined && !NETWORK_TYPES.has(options.networkType)) {
    throw new Error(`networkType must be one of ${[...NETWORK_TYPES].join(', ')}; got "${String(options.networkType)}".`);
  }
  if (options.model !== undefined && !MODELS.has(options.model)) {
    throw new Error(`model must be one of ${[...MODELS].join(', ')}; got "${String(options.model)}".`);
  }
  if (options.window !== undefined && !WINDOWS.has(options.window)) {
    throw new Error(`window must be one of ${[...WINDOWS].join(', ')}; got "${String(options.window)}".`);
  }
  if (options.weightBy !== undefined && typeof options.weightBy !== 'function' && options.weightBy !== 'binary' && options.weightBy !== 'sum') {
    throw new Error(`weightBy must be "binary", "sum", or a function; got "${String(options.weightBy)}".`);
  }
  if (options.windowSizeBack !== undefined && (typeof options.windowSizeBack !== 'number' || !isWindowSize(options.windowSizeBack))) {
    throw new Error(`windowSizeBack must be a non-negative integer or Infinity; got ${String(options.windowSizeBack)}.`);
  }
  if (options.windowSizeForward !== undefined && (typeof options.windowSizeForward !== 'number' || !isWindowSize(options.windowSizeForward))) {
    throw new Error(`windowSizeForward must be a non-negative integer or Infinity; got ${String(options.windowSizeForward)}.`);
  }
  if (options.mask !== undefined) {
    validateMask(options.mask, options.codes.length, options.networkType === 'ordered');
  }
  if (options.unitsUsed !== undefined && (!Array.isArray(options.unitsUsed) || options.unitsUsed.length === 0)) {
    throw new Error('unitsUsed must be a non-empty array of unit labels when provided; omit it to keep every unit.');
  }

  if (options.networkType === 'ordered') {
    const orderedHeaders = orderedAdjacencyKey(options.codes).map((entry) => entry.name);
    if (new Set(orderedHeaders).size !== orderedHeaders.length) {
      throw new Error('Ordered adjacency headers collide; use unambiguous code labels so every "<ground> & <response>" header is unique.');
    }
    const model = options.model ?? 'EndPoint';
    if (model !== 'EndPoint') {
      throw new Error(`Ordered network analysis requires model "EndPoint"; got "${model}".`);
    }
    const window = options.window ?? 'MovingStanzaWindow';
    if (window !== 'MovingStanzaWindow') {
      throw new Error(`Ordered network analysis requires window "MovingStanzaWindow"; got "${window}".`);
    }
    const windowSizeBack = options.windowSizeBack ?? 1;
    if (windowSizeBack !== Number.POSITIVE_INFINITY && (!Number.isInteger(windowSizeBack) || windowSizeBack < 1)) {
      throw new Error(`Ordered network analysis requires windowSizeBack to be an integer >= 1 or Infinity; got ${String(windowSizeBack)}.`);
    }
    const windowSizeForward = options.windowSizeForward ?? 0;
    if (windowSizeForward !== 0) {
      throw new Error(`Ordered network analysis only supports backward windows; windowSizeForward must be 0; got ${String(windowSizeForward)}.`);
    }
    if (options.weightBy !== undefined && options.weightBy !== 'sum') {
      const received = typeof options.weightBy === 'function' ? 'function' : `"${options.weightBy}"`;
      throw new Error(`Ordered network analysis preserves raw code counts and requires weightBy "sum"; got ${received}.`);
    }
  }
}

export function validateMakeSetOptions(options: MakeSetOptions): void {
  if (options.dimensions !== undefined && (!Number.isInteger(options.dimensions) || options.dimensions < 1)) {
    throw new Error(`dimensions must be an integer >= 1; got ${String(options.dimensions)}. (Values above the available rotated dimensions are clamped.)`);
  }
  if (options.rotation !== undefined && !ROTATION_METHODS.has(options.rotation.method)) {
    throw new Error(`rotation.method must be one of ${[...ROTATION_METHODS].join(', ')}; got "${String(options.rotation.method)}".`);
  }
  if (options.nodePositionMethod !== undefined && !NODE_POSITION_METHODS.has(options.nodePositionMethod)) {
    throw new Error(`nodePositionMethod must be one of ${[...NODE_POSITION_METHODS].join(', ')}; got "${String(options.nodePositionMethod)}".`);
  }
}

function formatWeightBy(weightBy: WeightBy): string {
  return typeof weightBy === 'function' ? 'function' : `"${weightBy}"`;
}

function validateExplicitStandardENADataSchema(enadata: ENAData): void {
  if (!Array.isArray(enadata.codes) || enadata.codes.length < 2) {
    throw new Error('Explicit standard ENAData codes must contain at least two unique labels.');
  }
  const duplicateCode = firstDuplicate(enadata.codes);
  if (duplicateCode !== undefined) {
    throw new Error(`Explicit standard ENAData codes must be unique; duplicate "${duplicateCode}".`);
  }
  const expectedKey = adjacencyKey(enadata.codes);
  const expectedWidth = expectedKey.length;
  if (!Array.isArray(enadata.codeColumns) || enadata.codeColumns.length !== expectedWidth) {
    throw new Error(
      `Explicit standard ENAData codeColumns must contain ${expectedWidth} upper-triangle headers for ` +
      `${enadata.codes.length} codes; got ${Array.isArray(enadata.codeColumns) ? enadata.codeColumns.length : typeof enadata.codeColumns}. ` +
      'Omit networkType only for legacy externally constructed directed data.'
    );
  }
  for (let index = 0; index < expectedWidth; index += 1) {
    const expected = expectedKey[index];
    if (enadata.codeColumns[index] !== expected?.name) {
      throw new Error(
        `Explicit standard ENAData codeColumns entry ${index} must be "${String(expected?.name)}"; ` +
        `got "${String(enadata.codeColumns[index])}".`
      );
    }
  }
  if (!Array.isArray(enadata.adjacencyKey) || enadata.adjacencyKey.length !== expectedWidth) {
    throw new Error(`Explicit standard ENAData adjacencyKey must contain ${expectedWidth} upper-triangle entries.`);
  }
  for (let index = 0; index < expectedWidth; index += 1) {
    const actual = enadata.adjacencyKey[index];
    const expected = expectedKey[index];
    if (!actual || !expected ||
      actual.source !== expected.source || actual.target !== expected.target ||
      actual.name !== expected.name || actual.sourceIndex !== expected.sourceIndex ||
      actual.targetIndex !== expected.targetIndex) {
      throw new Error(`Explicit standard ENAData adjacencyKey entry ${index} does not match the required upper-triangle key.`);
    }
  }
  if (!Array.isArray(enadata.connectionMatrix)) {
    throw new Error('Explicit standard ENAData connectionMatrix must be an array of undirected rows.');
  }
  if (!Array.isArray(enadata.connectionCounts)) {
    throw new Error('Explicit standard ENAData connectionCounts must be an array of undirected count rows.');
  }
  if (!Array.isArray(enadata.unitLabels)) {
    throw new Error('Explicit standard ENAData unitLabels must be an array.');
  }
  if (enadata.connectionMatrix.length !== enadata.connectionCounts.length ||
    enadata.connectionMatrix.length !== enadata.unitLabels.length) {
    throw new Error(
      `Explicit standard ENAData row counts must agree: connectionMatrix has ${enadata.connectionMatrix.length} rows, ` +
      `connectionCounts has ${enadata.connectionCounts.length}, and unitLabels has ${enadata.unitLabels.length}.`
    );
  }
  for (let rowIndex = 0; rowIndex < enadata.connectionMatrix.length; rowIndex += 1) {
    const row = enadata.connectionMatrix[rowIndex];
    if (!Array.isArray(row) || row.length !== expectedWidth) {
      throw new Error(
        `Explicit standard ENAData connectionMatrix row ${rowIndex} must contain ${expectedWidth} upper-triangle cells; ` +
        `got ${Array.isArray(row) ? row.length : typeof row}.`
      );
    }
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = row[columnIndex];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `Explicit standard ENAData connectionMatrix[${rowIndex}][${columnIndex}] must be a finite number; ` +
          `got ${String(value)}.`
        );
      }
    }
  }
  for (let rowIndex = 0; rowIndex < enadata.connectionCounts.length; rowIndex += 1) {
    const countRow = enadata.connectionCounts[rowIndex];
    if (!countRow || typeof countRow !== 'object' || Array.isArray(countRow)) {
      throw new Error(`Explicit standard ENAData connectionCounts row ${rowIndex} must be an object.`);
    }
    for (let columnIndex = 0; columnIndex < expectedKey.length; columnIndex += 1) {
      const column = expectedKey[columnIndex]!.name;
      if (!Object.prototype.hasOwnProperty.call(countRow, column)) {
        throw new Error(
          `Explicit standard ENAData connectionCounts row ${rowIndex} is missing upper-triangle column "${column}".`
        );
      }
      const countValue = countRow[column];
      if (typeof countValue !== 'number' || !Number.isFinite(countValue)) {
        throw new Error(
          `Explicit standard ENAData connectionCounts[${rowIndex}]["${column}"] must be a finite number; ` +
          `got ${String(countValue)}.`
        );
      }
      if (countValue !== enadata.connectionMatrix[rowIndex]?.[columnIndex]) {
        throw new Error(
          `Explicit standard ENAData connectionCounts[${rowIndex}]["${column}"] does not match ` +
          `connectionMatrix[${rowIndex}][${columnIndex}].`
        );
      }
    }
  }
}

/** Validates untrusted/manual ENAData before normalization, rotation, or SVD. */
export function validateENADataNetworkContract(enadata: ENAData): void {
  if (enadata.networkType !== undefined && !NETWORK_TYPES.has(enadata.networkType)) {
    throw new Error(`ENAData networkType must be one of ${[...NETWORK_TYPES].join(', ')}; got "${String(enadata.networkType)}".`);
  }
  if (!MODELS.has(enadata.modelType)) {
    throw new Error(`ENAData modelType must be one of ${[...MODELS].join(', ')}; got "${String(enadata.modelType)}".`);
  }
  if (!enadata.functionParams || typeof enadata.functionParams !== 'object') {
    throw new Error('ENAData functionParams must be an object.');
  }
  if (!MODELS.has(enadata.functionParams.model)) {
    throw new Error(`ENAData functionParams.model must be one of ${[...MODELS].join(', ')}; got "${String(enadata.functionParams.model)}".`);
  }
  if (enadata.modelType !== enadata.functionParams.model) {
    throw new Error(
      `ENAData modelType "${enadata.modelType}" does not match functionParams.model "${enadata.functionParams.model}".`
    );
  }
  const paramsNetworkType = enadata.functionParams.networkType;
  if (paramsNetworkType !== undefined && !NETWORK_TYPES.has(paramsNetworkType)) {
    throw new Error(
      `ENAData functionParams.networkType must be one of ${[...NETWORK_TYPES].join(', ')} when provided; ` +
      `got "${String(paramsNetworkType)}".`
    );
  }
  const dataNetworkType = enadata.networkType ?? 'standard';
  const normalizedParamsNetworkType = paramsNetworkType ?? 'standard';
  if (dataNetworkType !== normalizedParamsNetworkType) {
    throw new Error(
      `ENAData networkType "${dataNetworkType}" does not match ` +
      `functionParams.networkType "${normalizedParamsNetworkType}".`
    );
  }

  // Only an absent discriminator receives the legacy exception. Historically
  // jENA accepted externally constructed n*n matrices with an explicit
  // directed solver; callers can preserve that path by omitting networkType.
  if (dataNetworkType !== 'ordered') {
    if (enadata.networkType === 'standard') validateExplicitStandardENADataSchema(enadata);
    return;
  }

  if (enadata.modelType !== 'EndPoint' || enadata.functionParams.model !== 'EndPoint') {
    throw new Error('Ordered ENAData requires modelType and functionParams.model to be "EndPoint".');
  }
  if (enadata.functionParams.window !== 'MovingStanzaWindow') {
    throw new Error(
      `Ordered ENAData requires functionParams.window "MovingStanzaWindow"; got "${String(enadata.functionParams.window)}".`
    );
  }
  const back = enadata.functionParams.windowSizeBack;
  if (back !== Number.POSITIVE_INFINITY && (!Number.isInteger(back) || back < 1)) {
    throw new Error(
      `Ordered ENAData requires functionParams.windowSizeBack to be an integer >= 1 or Infinity; got ${String(back)}.`
    );
  }
  if (enadata.functionParams.windowSizeForward !== 0) {
    throw new Error(
      `Ordered ENAData requires functionParams.windowSizeForward 0; got ${String(enadata.functionParams.windowSizeForward)}.`
    );
  }
  if (enadata.functionParams.weightBy !== 'sum') {
    throw new Error(
      `Ordered ENAData requires functionParams.weightBy "sum"; got ${formatWeightBy(enadata.functionParams.weightBy)}.`
    );
  }
  if (!Array.isArray(enadata.codes) || enadata.codes.length < 2) {
    throw new Error('Ordered ENAData codes must contain at least two unique labels.');
  }
  const duplicateCode = firstDuplicate(enadata.codes);
  if (duplicateCode !== undefined) {
    throw new Error(`Ordered ENAData codes must be unique; duplicate "${duplicateCode}".`);
  }

  const expectedKey = orderedAdjacencyKey(enadata.codes);
  const expectedWidth = expectedKey.length;
  const expectedHeaders = expectedKey.map((entry) => entry.name);
  if (new Set(expectedHeaders).size !== expectedHeaders.length) {
    throw new Error('Ordered ENAData adjacency headers collide; use unambiguous code labels.');
  }
  if (!Array.isArray(enadata.codeColumns) || enadata.codeColumns.length !== expectedWidth) {
    throw new Error(
      `Ordered ENAData codeColumns must contain ${expectedWidth} column-major directed headers for ` +
      `${enadata.codes.length} codes; got ${Array.isArray(enadata.codeColumns) ? enadata.codeColumns.length : typeof enadata.codeColumns}.`
    );
  }
  for (let index = 0; index < expectedWidth; index += 1) {
    if (enadata.codeColumns[index] !== expectedHeaders[index]) {
      throw new Error(
        `Ordered ENAData codeColumns entry ${index} must be "${expectedHeaders[index]}"; ` +
        `got "${String(enadata.codeColumns[index])}".`
      );
    }
  }
  if (!Array.isArray(enadata.adjacencyKey) || enadata.adjacencyKey.length !== expectedWidth) {
    throw new Error(
      `Ordered ENAData adjacencyKey must contain ${expectedWidth} column-major entries; ` +
      `got ${Array.isArray(enadata.adjacencyKey) ? enadata.adjacencyKey.length : typeof enadata.adjacencyKey}.`
    );
  }
  for (let index = 0; index < expectedWidth; index += 1) {
    const actual = enadata.adjacencyKey[index];
    const expected = expectedKey[index];
    if (!actual || !expected ||
      actual.source !== expected.source || actual.target !== expected.target ||
      actual.name !== expected.name || actual.sourceIndex !== expected.sourceIndex ||
      actual.targetIndex !== expected.targetIndex) {
      throw new Error(
        `Ordered ENAData adjacencyKey entry ${index} does not match the required column-major ground-to-response key.`
      );
    }
  }
  if (!Array.isArray(enadata.connectionMatrix)) {
    throw new Error('Ordered ENAData connectionMatrix must be an array of directed rows.');
  }
  for (let rowIndex = 0; rowIndex < enadata.connectionMatrix.length; rowIndex += 1) {
    const row = enadata.connectionMatrix[rowIndex];
    if (!Array.isArray(row) || row.length !== expectedWidth) {
      throw new Error(
        `Ordered ENAData connectionMatrix row ${rowIndex} must contain ${expectedWidth} directed cells; ` +
        `got ${Array.isArray(row) ? row.length : typeof row}.`
      );
    }
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = row[columnIndex];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `Ordered ENAData connectionMatrix[${rowIndex}][${columnIndex}] must be a finite number; got ${String(value)}.`
        );
      }
      if (value < 0) {
        throw new Error(
          `Ordered ENAData connectionMatrix[${rowIndex}][${columnIndex}] must be a finite non-negative number; got ${String(value)}.`
        );
      }
    }
  }
  if (!Array.isArray(enadata.connectionCounts)) {
    throw new Error('Ordered ENAData connectionCounts must be an array of directed count rows.');
  }
  if (!Array.isArray(enadata.unitLabels)) {
    throw new Error('Ordered ENAData unitLabels must be an array.');
  }
  if (enadata.connectionMatrix.length !== enadata.connectionCounts.length ||
    enadata.connectionMatrix.length !== enadata.unitLabels.length) {
    throw new Error(
      `Ordered ENAData row counts must agree: connectionMatrix has ${enadata.connectionMatrix.length} rows, ` +
      `connectionCounts has ${enadata.connectionCounts.length}, and unitLabels has ${enadata.unitLabels.length}.`
    );
  }
  for (let rowIndex = 0; rowIndex < enadata.connectionCounts.length; rowIndex += 1) {
    const countRow = enadata.connectionCounts[rowIndex];
    if (!countRow || typeof countRow !== 'object' || Array.isArray(countRow)) {
      throw new Error(`Ordered ENAData connectionCounts row ${rowIndex} must be an object.`);
    }
    for (let columnIndex = 0; columnIndex < expectedHeaders.length; columnIndex += 1) {
      const column = expectedHeaders[columnIndex]!;
      if (!Object.prototype.hasOwnProperty.call(countRow, column)) {
        throw new Error(`Ordered ENAData connectionCounts row ${rowIndex} is missing directed column "${column}".`);
      }
      const countValue = countRow[column];
      if (typeof countValue !== 'number' || !Number.isFinite(countValue)) {
        throw new Error(
          `Ordered ENAData connectionCounts[${rowIndex}]["${column}"] must be a finite number; got ${String(countValue)}.`
        );
      }
      if (countValue < 0) {
        throw new Error(
          `Ordered ENAData connectionCounts[${rowIndex}]["${column}"] must be a finite non-negative number; got ${String(countValue)}.`
        );
      }
      if (countValue !== enadata.connectionMatrix[rowIndex]?.[columnIndex]) {
        throw new Error(
          `Ordered ENAData connectionCounts[${rowIndex}]["${column}"] does not match ` +
          `connectionMatrix[${rowIndex}][${columnIndex}].`
        );
      }
    }
  }
}
