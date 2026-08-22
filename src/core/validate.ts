import type { AccumulateOptions, MakeSetOptions, Matrix } from '../types.js';

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

function validateMask(mask: Matrix, codeCount: number): void {
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
    validateMask(options.mask, options.codes.length);
  }
  if (options.unitsUsed !== undefined && (!Array.isArray(options.unitsUsed) || options.unitsUsed.length === 0)) {
    throw new Error('unitsUsed must be a non-empty array of unit labels when provided; omit it to keep every unit.');
  }

  if (options.networkType === 'ordered') {
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
