import type { ENAOptions } from '../ena.js';
import { extractMakeSetOptions } from '../ena.js';
import { makeSet } from '../model.js';
import { createAccumulationStream } from '../performance.js';
import type { ENASet, Row } from '../types.js';

// Worker protocol v1 (advisory F-008). Every message carries a version tag so
// the schema can evolve without silently misinterpreting stale worker
// bundles. Runs execute chunk-by-chunk and yield to the event loop between
// chunks, which is what makes `cancel` real: the worker's message queue gets
// a chance to deliver it mid-run, and cancellation takes effect at the next
// chunk boundary. The projection stage (SVD) is a single synchronous step,
// so a cancel arriving during it is honored just before the result would be
// posted.

export const ENA_WORKER_PROTOCOL_VERSION = 1;

/**
 * Options accepted across the worker boundary. `weightBy` functions cannot
 * be structured-cloned, so only the string forms are representable here.
 */
export type ENAWorkerOptions = Omit<ENAOptions, 'weightBy'> & { weightBy?: 'binary' | 'sum' };

export type ENAWorkerStage = 'accumulate' | 'model';

export type ENAWorkerRequest =
  | { v: 1; kind: 'run'; id: string; options: ENAWorkerOptions; chunkSize?: number }
  | { v: 1; kind: 'cancel'; id: string };

export type ENAWorkerResponse =
  | { v: 1; kind: 'progress'; id: string; progress: number; stage: ENAWorkerStage }
  | { v: 1; kind: 'result'; id: string; result: ENASet }
  | { v: 1; kind: 'cancelled'; id: string }
  | { v: 1; kind: 'error'; id: string; message: string };

/** Structural message event, so no DOM lib is needed (advisory F-014). */
export interface ENAWorkerMessageEvent<T> {
  data: T;
}

export interface ENAWorkerScope {
  addEventListener(type: 'message', listener: (event: ENAWorkerMessageEvent<ENAWorkerRequest>) => void): void;
  postMessage(message: ENAWorkerResponse): void;
}

const DEFAULT_CHUNK_SIZE = 2000;
// Share of the progress range covered by accumulation; the model/projection
// stage is a single synchronous step at the end.
const ACCUMULATE_PROGRESS_SPAN = 0.9;

interface WorkerRun {
  id: string;
  options: ENAWorkerOptions;
  chunkSize: number;
  cancelled: boolean;
}

function yieldToMessageQueue(): Promise<void> {
  // Must be a macrotask: pending worker messages (cancel!) are delivered
  // between macrotasks, not between microtasks.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wires the ENA worker protocol onto a worker scope. Exported so tests (and
 * custom worker shims) can host the exact production message handler on an
 * in-memory channel.
 */
export function createENAWorkerHost(scope: ENAWorkerScope): void {
  const queue: WorkerRun[] = [];
  let active: WorkerRun | null = null;
  let pumping = false;

  const post = (message: ENAWorkerResponse): void => scope.postMessage(message);

  const executeRun = async (run: WorkerRun): Promise<void> => {
    const { id } = run;
    let stream: ReturnType<typeof createAccumulationStream> | undefined;
    try {
      if (run.cancelled) {
        post({ v: 1, kind: 'cancelled', id });
        return;
      }
      if (typeof (run.options as ENAOptions).weightBy === 'function') {
        throw new TypeError('weightBy functions cannot cross the worker boundary; use "binary" or "sum".');
      }
      const rows: Row[] = run.options.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('rows is empty; provide at least one coded data row.');
      }
      post({ v: 1, kind: 'progress', id, progress: 0, stage: 'accumulate' });

      const { rows: _rows, ...streamOptions } = run.options;
      stream = createAccumulationStream({ ...streamOptions, expectedRows: rows.length });
      for (let index = 0; index < rows.length; index += run.chunkSize) {
        if (run.cancelled) {
          post({ v: 1, kind: 'cancelled', id });
          return;
        }
        stream.push(rows.slice(index, index + run.chunkSize));
        const covered = Math.min(1, (index + run.chunkSize) / rows.length);
        post({ v: 1, kind: 'progress', id, progress: ACCUMULATE_PROGRESS_SPAN * covered, stage: 'accumulate' });
        await yieldToMessageQueue();
      }
      if (run.cancelled) {
        post({ v: 1, kind: 'cancelled', id });
        return;
      }

      const enadata = stream.finish();
      post({ v: 1, kind: 'progress', id, progress: ACCUMULATE_PROGRESS_SPAN, stage: 'model' });
      const result = makeSet(enadata, extractMakeSetOptions(run.options));
      if (run.cancelled) {
        post({ v: 1, kind: 'cancelled', id });
        return;
      }
      post({ v: 1, kind: 'progress', id, progress: 1, stage: 'model' });
      post({ v: 1, kind: 'result', id, result });
    } catch (error) {
      post({ v: 1, kind: 'error', id, message: error instanceof Error ? error.message : String(error) });
    } finally {
      stream?.dispose();
    }
  };

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      let next = queue.shift();
      while (next) {
        active = next;
        await executeRun(next);
        active = null;
        next = queue.shift();
      }
    } finally {
      active = null;
      pumping = false;
    }
  };

  scope.addEventListener('message', (event: ENAWorkerMessageEvent<ENAWorkerRequest>) => {
    const message = event.data;
    if (!message || message.v !== ENA_WORKER_PROTOCOL_VERSION || typeof message.id !== 'string') return;
    if (message.kind === 'cancel') {
      // Marks the queued or active run; unknown/settled ids are ignored, so
      // nothing accumulates (the old module-level Set leaked forever).
      const current = active;
      if (current && current.id === message.id) current.cancelled = true;
      const queued = queue.find((run) => run.id === message.id);
      if (queued) queued.cancelled = true;
      return;
    }
    if (message.kind === 'run') {
      const rawChunk = message.chunkSize;
      const chunkSize = rawChunk !== undefined && Number.isInteger(rawChunk) && rawChunk > 0 ? rawChunk : DEFAULT_CHUNK_SIZE;
      queue.push({ id: message.id, options: message.options, chunkSize, cancelled: false });
      void pump();
    }
  });
}

declare const self: ENAWorkerScope | undefined;

// Auto-attach when running inside a real worker scope; guarded so the module
// is also importable from Node (tests, SSR bundlers).
if (typeof self !== 'undefined' && typeof self?.postMessage === 'function') {
  createENAWorkerHost(self);
}
