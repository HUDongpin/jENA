import type { ENASet } from '../types.js';
import type { ENAWorkerMessageEvent, ENAWorkerOptions, ENAWorkerRequest, ENAWorkerResponse, ENAWorkerStage } from './worker.js';

export type { ENAWorkerMessageEvent, ENAWorkerOptions, ENAWorkerRequest, ENAWorkerResponse, ENAWorkerStage } from './worker.js';

export interface ENAWorkerProgress {
  id: string;
  progress: number;
  stage: ENAWorkerStage;
}

export interface ENAWorkerLike {
  postMessage(message: ENAWorkerRequest): void;
  addEventListener(type: 'message', listener: (event: ENAWorkerMessageEvent<ENAWorkerResponse>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: unknown) => void): void;
  removeEventListener(type: 'message', listener: (event: ENAWorkerMessageEvent<ENAWorkerResponse>) => void): void;
  removeEventListener(type: 'error' | 'messageerror', listener: (event: unknown) => void): void;
  terminate?: () => void;
}

export interface ENAWorkerRunOptions {
  onProgress?: (progress: ENAWorkerProgress) => void;
  /**
   * Cancels the run when the signal aborts. Factory-backed clients terminate
   * and replace the worker so synchronous model/SVD work is actually stopped.
   * Instance-only clients reject immediately after posting a cooperative
   * cancel; once model work is observed they terminate the supplied worker,
   * when supported, and cannot be reused. Without a factory, synchronous work
   * that began before model progress was observed may continue in the worker.
   */
  signal?: AbortSignal;
  /**
   * Cancels after this interval. Factory-backed clients terminate and replace
   * the worker. Instance-only clients reject immediately after posting a
   * cooperative cancel, but terminate and become unavailable if the model
   * stage has already been observed and `terminate()` exists. Without a
   * factory, an already-running synchronous model may continue in the worker.
   */
  timeoutMs?: number;
  /** Rows per accumulation chunk; smaller chunks mean finer progress/cancel granularity. */
  chunkSize?: number;
}

export interface ENAWorkerClientOptions {
  /**
   * Creates a fresh dedicated worker after a hard cancellation. Supplying a
   * factory enables preemptive cancellation of synchronous model/SVD work and
   * keeps the client reusable. The current worker and every replacement must
   * implement `terminate()`.
   *
   * Terminating a worker also discards its queue, so every other pending run
   * rejects with `ENAWorkerRestartedError`; later runs use the replacement.
   */
  workerFactory?: () => ENAWorkerLike;
  /**
   * Maximum number of client requests awaiting a terminal worker response.
   * Admission is checked before `postMessage`, so rejected runs do not clone
   * or enqueue their payload. Set to 0 to reject every run.
   */
  maxPendingRuns?: number;
}

export interface ENAWorkerRunHandle {
  id: string;
  promise: Promise<ENASet>;
  cancel(): void;
}

export interface ENAWorkerClient {
  run(options: ENAWorkerOptions, runOptions?: ENAWorkerRunOptions | ((progress: ENAWorkerProgress) => void)): Promise<ENASet>;
  start(options: ENAWorkerOptions, runOptions?: ENAWorkerRunOptions | ((progress: ENAWorkerProgress) => void)): ENAWorkerRunHandle;
  /** Uses the same factory-backed hard-stop or immediate instance-only rejection as signal cancellation. */
  cancel(id: string): void;
  terminate(): void;
}

/** Rejection reason when a run is cancelled (explicitly, via signal, or by timeout). */
export class ENAWorkerCancelledError extends Error {
  constructor(id: string, detail = 'was cancelled') {
    super(`ENA worker run ${id} ${detail}.`);
    this.name = 'ENAWorkerCancelledError';
  }
}

/** Rejection reason for other runs discarded by a cancellation-driven restart. */
export class ENAWorkerRestartedError extends Error {
  constructor(id: string, cancelledId: string) {
    super(`ENA worker run ${id} was interrupted because the worker restarted to cancel run ${cancelledId}.`);
    this.name = 'ENAWorkerRestartedError';
  }
}

interface PendingRequest {
  resolve(result: ENASet): void;
  reject(error: Error): void;
  onProgress?: (progress: ENAWorkerProgress) => void;
  stage: ENAWorkerStage | undefined;
  cleanup(): void;
}

interface WorkerBinding {
  worker: ENAWorkerLike;
  onMessage(event: ENAWorkerMessageEvent<ENAWorkerResponse>): void;
  onError(event: unknown): void;
  onMessageError(event: unknown): void;
}

export const DEFAULT_ENA_WORKER_MAX_PENDING_RUNS = 33;

let nextWorkerRequestId = 1;

function makeRequestId(): string {
  const id = `ena-worker-${nextWorkerRequestId}`;
  nextWorkerRequestId += 1;
  return id;
}

function normalizeRunOptions(runOptions?: ENAWorkerRunOptions | ((progress: ENAWorkerProgress) => void)): ENAWorkerRunOptions {
  if (typeof runOptions === 'function') return { onProgress: runOptions };
  return runOptions ?? {};
}

function isWorkerResponse(data: unknown): data is ENAWorkerResponse {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Record<string, unknown>;
  return message.v === 1 &&
    typeof message.id === 'string' &&
    (message.kind === 'progress' || message.kind === 'result' || message.kind === 'cancelled' || message.kind === 'error');
}

function looksLikeENASet(result: unknown): result is ENASet {
  if (typeof result !== 'object' || result === null) return false;
  const set = result as Record<string, unknown>;
  return Array.isArray(set.points) && typeof set.rotation === 'object' && set.rotation !== null;
}

/**
 * Creates a client around an existing worker. The one-argument form remains
 * supported; pass `workerFactory` to make hard cancellations transparently
 * recreate the worker and keep the client usable.
 */
export function createENAWorkerClient(initialWorker: ENAWorkerLike, options: ENAWorkerClientOptions = {}): ENAWorkerClient {
  const pending = new Map<string, PendingRequest>();
  const inFlight = new Set<string>();
  const workerFactory = options.workerFactory;
  const maxPendingRuns = options.maxPendingRuns ?? DEFAULT_ENA_WORKER_MAX_PENDING_RUNS;
  let binding: WorkerBinding | undefined;
  let unavailableError: Error | undefined;
  let closed = false;

  if (!Number.isInteger(maxPendingRuns) || maxPendingRuns < 0) {
    throw new RangeError('maxPendingRuns must be a non-negative integer.');
  }
  if (workerFactory && typeof initialWorker.terminate !== 'function') {
    throw new TypeError('workerFactory requires the current worker and every replacement to implement terminate().');
  }

  const settle = (id: string): PendingRequest | undefined => {
    const request = pending.get(id);
    if (!request) return undefined;
    pending.delete(id);
    request.cleanup();
    return request;
  };

  const rejectAll = (error: Error): void => {
    for (const id of [...pending.keys()]) settle(id)?.reject(error);
    inFlight.clear();
  };

  const onMessage = (source: ENAWorkerLike, event: ENAWorkerMessageEvent<ENAWorkerResponse>): void => {
    if (binding?.worker !== source) return;
    const response = event.data;
    if (!isWorkerResponse(response)) return;
    if (response.kind !== 'progress') inFlight.delete(response.id);
    const request = pending.get(response.id);
    if (!request) return;
    switch (response.kind) {
      case 'progress':
        request.stage = response.stage;
        request.onProgress?.({ id: response.id, progress: response.progress, stage: response.stage });
        return;
      case 'result':
        if (!looksLikeENASet(response.result)) {
          settle(response.id)?.reject(new Error('ENA worker returned a malformed result payload.'));
          return;
        }
        settle(response.id)?.resolve(response.result);
        return;
      case 'cancelled':
        settle(response.id)?.reject(new ENAWorkerCancelledError(response.id));
        return;
      case 'error':
        settle(response.id)?.reject(new Error(response.message));
        return;
    }
  };

  const onError = (source: ENAWorkerLike, event: unknown): void => {
    if (binding?.worker !== source) return;
    const detail = typeof event === 'object' && event !== null && 'message' in event
      ? String((event as { message: unknown }).message)
      : 'unknown error';
    rejectAll(new Error(`ENA worker failed: ${detail}`));
  };
  const onMessageError = (source: ENAWorkerLike): void => {
    if (binding?.worker !== source) return;
    rejectAll(new Error('ENA worker message could not be deserialized.'));
  };

  const detach = (current: WorkerBinding): void => {
    current.worker.removeEventListener('message', current.onMessage);
    current.worker.removeEventListener('error', current.onError);
    current.worker.removeEventListener('messageerror', current.onMessageError);
    if (binding === current) binding = undefined;
  };

  const attach = (worker: ENAWorkerLike): void => {
    if (workerFactory && typeof worker.terminate !== 'function') {
      throw new TypeError('workerFactory requires the current worker and every replacement to implement terminate().');
    }
    const current: WorkerBinding = {
      worker,
      onMessage: (event) => onMessage(worker, event),
      onError: (event) => onError(worker, event),
      onMessageError: () => onMessageError(worker)
    };
    worker.addEventListener('message', current.onMessage);
    worker.addEventListener('error', current.onError);
    worker.addEventListener('messageerror', current.onMessageError);
    binding = current;
  };

  const recreate = (previous: ENAWorkerLike, cancelledId: string): void => {
    if (!workerFactory || closed) {
      unavailableError = new Error(
        `ENA worker client cannot accept new runs after terminating its only worker to cancel run ${cancelledId}; ` +
        'pass workerFactory when creating the client to enable recovery.'
      );
      return;
    }
    try {
      const replacement = workerFactory();
      if (replacement === previous) {
        throw new Error('workerFactory returned the terminated worker instead of a fresh instance.');
      }
      attach(replacement);
      unavailableError = undefined;
    } catch (error) {
      unavailableError = new Error(
        `ENA worker could not be recreated after cancelling run ${cancelledId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const hardCancel = (id: string, cancellationError: ENAWorkerCancelledError): boolean => {
    const current = binding;
    if (!current || typeof current.worker.terminate !== 'function' || !pending.has(id)) return false;

    detach(current);
    let terminationError: Error | undefined;
    try {
      current.worker.terminate();
    } catch (error) {
      terminationError = new Error(
        `ENA worker could not be terminated while cancelling run ${id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    for (const pendingId of [...pending.keys()]) {
      const request = settle(pendingId);
      if (!request) continue;
      request.reject(terminationError ?? (pendingId === id
        ? cancellationError
        : new ENAWorkerRestartedError(pendingId, id)));
    }
    inFlight.clear();
    if (terminationError) {
      unavailableError = terminationError;
      return true;
    }
    recreate(current.worker, id);
    return true;
  };

  const cancel = (id: string, cancellationError = new ENAWorkerCancelledError(id)): void => {
    const request = pending.get(id);
    if (!request) {
      // Preserve the original instance API's ability to forward an id even if
      // the associated run was posted outside this client.
      binding?.worker.postMessage({ v: 1, kind: 'cancel', id });
      return;
    }

    // A factory-backed client always has a replacement available. An
    // instance-only client hard-stops only after the synchronous model stage
    // is known to have started; otherwise its promise rejects immediately
    // after posting a cooperative cancel so the supplied instance remains
    // reusable once that worker-side cancellation takes effect.
    if ((workerFactory || request.stage === 'model') && hardCancel(id, cancellationError)) return;

    const worker = binding?.worker;
    if (!worker) {
      settle(id)?.reject(unavailableError ?? new Error('ENA worker client has no active worker.'));
      return;
    }
    try {
      worker.postMessage({ v: 1, kind: 'cancel', id });
      settle(id)?.reject(cancellationError);
    } catch (error) {
      settle(id)?.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const start = (options: ENAWorkerOptions, runOptionsInput?: ENAWorkerRunOptions | ((progress: ENAWorkerProgress) => void)): ENAWorkerRunHandle => {
    if (typeof (options as { weightBy?: unknown }).weightBy === 'function') {
      throw new TypeError('weightBy functions cannot cross the worker boundary; use "binary" or "sum".');
    }
    const runOptions = normalizeRunOptions(runOptionsInput);
    const id = makeRequestId();
    const promise = new Promise<ENASet>((resolve, reject) => {
      if (runOptions.signal?.aborted) {
        reject(new ENAWorkerCancelledError(id, 'was cancelled before it started'));
        return;
      }
      if (closed || unavailableError || !binding) {
        reject(unavailableError ?? new Error('ENA worker client terminated.'));
        return;
      }
      if (inFlight.size >= maxPendingRuns) {
        reject(new Error(`ENA worker client limit of ${maxPendingRuns} pending runs was reached.`));
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => cancel(id, new ENAWorkerCancelledError(id));
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        runOptions.signal?.removeEventListener('abort', onAbort);
      };

      const request: PendingRequest = runOptions.onProgress
        ? { resolve, reject, onProgress: runOptions.onProgress, stage: undefined, cleanup }
        : { resolve, reject, stage: undefined, cleanup };
      pending.set(id, request);

      runOptions.signal?.addEventListener('abort', onAbort, { once: true });
      if (runOptions.timeoutMs !== undefined && Number.isFinite(runOptions.timeoutMs)) {
        timer = setTimeout(() => {
          cancel(
            id,
            new ENAWorkerCancelledError(id, `timed out after ${runOptions.timeoutMs}ms`)
          );
        }, runOptions.timeoutMs);
      }

      const request_: ENAWorkerRequest = runOptions.chunkSize !== undefined
        ? { v: 1, kind: 'run', id, options, chunkSize: runOptions.chunkSize }
        : { v: 1, kind: 'run', id, options };
      inFlight.add(id);
      try {
        binding.worker.postMessage(request_);
      } catch (error) {
        inFlight.delete(id);
        settle(id)?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return {
      id,
      promise,
      cancel(): void {
        cancel(id, new ENAWorkerCancelledError(id));
      }
    };
  };

  attach(initialWorker);

  return {
    run(options, runOptions): Promise<ENASet> {
      return start(options, runOptions).promise;
    },
    start,
    cancel(id): void {
      cancel(id, new ENAWorkerCancelledError(id));
    },
    terminate(): void {
      if (closed) return;
      closed = true;
      const current = binding;
      if (current) detach(current);
      rejectAll(new Error('ENA worker client terminated.'));
      current?.worker.terminate?.();
      unavailableError = new Error('ENA worker client terminated.');
    }
  };
}
