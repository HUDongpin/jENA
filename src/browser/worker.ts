import type { ENAOptions } from '../ena.js';
import { extractMakeSetOptions } from '../ena.js';
import { makeSet } from '../model.js';
import { createAccumulationStream } from '../performance.js';
import type { ENASet, Row } from '../types.js';

// Worker protocol v1 (advisory F-008). Every message carries a version tag so
// the schema can evolve without silently misinterpreting stale worker
// bundles. Accumulation yields between chunks, so an in-worker `cancel`
// message takes effect at the next chunk boundary. The model/projection stage
// (including SVD) is synchronous and cannot receive another worker message;
// preempting that stage requires the owning client to terminate the worker.

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

export interface ENAWorkerHostOptions {
  /** Maximum number of runs waiting behind the active run. */
  maxQueuedRuns?: number;
}

const DEFAULT_CHUNK_SIZE = 2000;
export const DEFAULT_ENA_WORKER_MAX_QUEUED_RUNS = 32;
// Share of the progress range covered by accumulation; the model/projection
// stage is a single synchronous step at the end.
const ACCUMULATE_PROGRESS_SPAN = 0.9;

interface WorkerRun {
  id: string;
  options: ENAWorkerOptions | undefined;
  chunkSize: number;
  cancelled: boolean;
  previous: WorkerRun | null;
  next: WorkerRun | null;
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
export function createENAWorkerHost(scope: ENAWorkerScope, options: ENAWorkerHostOptions = {}): void {
  const maxQueuedRuns = options.maxQueuedRuns ?? DEFAULT_ENA_WORKER_MAX_QUEUED_RUNS;
  if (!Number.isInteger(maxQueuedRuns) || maxQueuedRuns < 0) {
    throw new RangeError('maxQueuedRuns must be a non-negative integer.');
  }

  let queueHead: WorkerRun | null = null;
  let queueTail: WorkerRun | null = null;
  const queuedById = new Map<string, WorkerRun>();
  const knownIds = new Set<string>();
  let active: WorkerRun | null = null;
  let pumping = false;

  const post = (message: ENAWorkerResponse): void => scope.postMessage(message);

  const executeRun = async (run: WorkerRun): Promise<void> => {
    const { id } = run;
    let stream: ReturnType<typeof createAccumulationStream> | undefined;
    try {
      const runOptions = run.options;
      if (run.cancelled || !runOptions) {
        post({ v: 1, kind: 'cancelled', id });
        return;
      }
      if (typeof (runOptions as ENAOptions).weightBy === 'function') {
        throw new TypeError('weightBy functions cannot cross the worker boundary; use "binary" or "sum".');
      }
      const rows: Row[] = runOptions.rows;
      if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error('rows is empty; provide at least one coded data row.');
      }
      post({ v: 1, kind: 'progress', id, progress: 0, stage: 'accumulate' });

      const { rows: _rows, ...streamOptions } = runOptions;
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
      const result = makeSet(enadata, extractMakeSetOptions(runOptions));
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

  const removeQueued = (run: WorkerRun): void => {
    if (run.previous) run.previous.next = run.next;
    else queueHead = run.next;
    if (run.next) run.next.previous = run.previous;
    else queueTail = run.previous;
    queuedById.delete(run.id);
    run.previous = null;
    run.next = null;
  };

  const takeNext = (): WorkerRun | undefined => {
    const next = queueHead;
    if (!next) return undefined;
    removeQueued(next);
    return next;
  };

  const pump = async (): Promise<void> => {
    if (pumping) return;
    pumping = true;
    try {
      let next = takeNext();
      while (next) {
        active = next;
        try {
          await executeRun(next);
        } finally {
          knownIds.delete(next.id);
          next.options = undefined;
          active = null;
        }
        next = takeNext();
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
      const current = active;
      if (current && current.id === message.id) {
        current.cancelled = true;
        return;
      }
      const queued = queuedById.get(message.id);
      if (queued) {
        removeQueued(queued);
        knownIds.delete(message.id);
        queued.cancelled = true;
        queued.options = undefined;
        post({ v: 1, kind: 'cancelled', id: message.id });
      }
      return;
    }
    if (message.kind === 'run') {
      if (knownIds.has(message.id)) {
        // Protocol v1 correlates terminal responses only by request id. Sending
        // an error for a duplicate would therefore settle the first accepted
        // request incorrectly; preserve that request and drop the duplicate.
        return;
      }
      const startsImmediately = active === null && !pumping && queuedById.size === 0;
      if (!startsImmediately && queuedById.size >= maxQueuedRuns) {
        post({
          v: 1,
          kind: 'error',
          id: message.id,
          message: `ENA worker queue limit of ${maxQueuedRuns} waiting requests was reached.`
        });
        return;
      }
      const rawChunk = message.chunkSize;
      const chunkSize = rawChunk !== undefined && Number.isInteger(rawChunk) && rawChunk > 0 ? rawChunk : DEFAULT_CHUNK_SIZE;
      const run: WorkerRun = {
        id: message.id,
        options: message.options,
        chunkSize,
        cancelled: false,
        previous: queueTail,
        next: null
      };
      if (queueTail) queueTail.next = run;
      else queueHead = run;
      queueTail = run;
      knownIds.add(message.id);
      queuedById.set(message.id, run);
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
