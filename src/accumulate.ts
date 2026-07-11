/*
 * Derived from rENA 0.3.1 (GPL-3), (c) the rENA authors: Cody L Marquart,
 * Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and
 * David Williamson Shaffer. This file ports the accumulation semantics of
 * R/ena.accumulate.data.R.
 * TypeScript translation and modifications for jena-js, GPL-3.0-only.
 * See PROVENANCE.md for the upstream NOTICE and version pin.
 */
import type { AccumulateOptions, ENAData } from './types.js';
import { refWindowLag } from './core/index.js';
import { validateAccumulateOptions } from './core/validate.js';
import { accumulateDataChunked } from './performance.js';

/**
 * Batch accumulation. Since the engine consolidation (advisory F-007) this
 * is a thin wrapper over the streaming core — one implementation of the
 * window/mask/weight logic serves both the batch and chunked/streaming
 * entry points. The result is verified byte-identical to the historical
 * batch engine by the golden parity suite and the chunk-size equivalence
 * and randomized property tests.
 */
export function accumulateData(options: AccumulateOptions): ENAData {
  validateAccumulateOptions(options);
  return accumulateDataChunked({ ...options, chunkSize: Math.max(1, options.rows.length) });
}

export { refWindowLag };
