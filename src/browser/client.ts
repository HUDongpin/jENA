import type { ENASet } from '../types.js';
import type { ENAWorkerOptions, ENAWorkerRequest, ENAWorkerResponse, ENAWorkerStage } from './worker.js';

export type { ENAWorkerOptions, ENAWorkerRequest, ENAWorkerResponse, ENAWorkerStage } from './worker.js';

export interface ENAWorkerProgress {
  id: string;
  progress: number;
  stage: ENAWorkerStage;
}

export interface ENAWorkerLike {
  postMessage(message: ENAWorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ENAWorkerResponse>) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (event: unknown) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<ENAWorkerResponse>) => void): void;
  removeEventListener(type: 'error' | 'messageerror', listener: (event: unknown) => void): void;
  terminate?: () => void;
}

export interface ENAWorkerRunOptions {
  onProgress?: (progress: ENAWorkerProgress) => void;
  /** Cancels the run when the signal aborts (rejects with ENAWorkerCancelledError). */
  signal?: AbortSignal;
  /** Rejects (and cancels the worker-side run) if no result arrives in time. */
  timeoutMs?: number;
  /** Rows per accumulation chunk; smaller chunks mean finer progress/cancel granularity. */
  chunkSize?: number;
}

export interface ENAWorkerRunHandle {
  id: string;
  promise: Promise<ENASet>;
  cancel(): void;
}

export interface ENAWorkerClient {
  run(options: ENAWorkerOptions, runOptions?: ENAWorkerRunOptions | ((progress: ENAWorkerProgress) => void)): Promise<ENASet>;
  start(options: ENAWorkerOptions, runOptions?: ENAWorkerRunOptions | ((progress: ENAWorkerProgress) => void)): ENAWorkerRunHandle;
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

interface PendingRequest {
  resolve(result: ENASet): void;
  reject(error: Error): void;
  onProgress?: (progress: ENAWorkerProgress) => void;
  cleanup(): void;
}

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

export function createENAWorkerClient(worker: ENAWorkerLike): ENAWorkerClient {
  const pending = new Map<string, PendingRequest>();

  const settle = (id: string): PendingRequest | undefined => {
    const request = pending.get(id);
    if (!request) return undefined;
    pending.delete(id);
    request.cleanup();
    return request;
  };

  const rejectAll = (error: Error): void => {
    for (const id of [...pending.keys()]) settle(id)?.reject(error);
  };

  const onMessage = (event: MessageEvent<ENAWorkerResponse>): void => {
    const response = event.data;
    if (!isWorkerResponse(response)) return;
    const request = pending.get(response.id);
    if (!request) return;
    switch (response.kind) {
      case 'progress':
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

  // A crashed worker (or an undeliverable message) must never leave callers
  // hanging: reject everything in flight (advisory F-008).
  const onError = (event: unknown): void => {
    const detail = typeof event === 'object' && event !== null && 'message' in event
      ? String((event as { message: unknown }).message)
      : 'unknown error';
    rejectAll(new Error(`ENA worker failed: ${detail}`));
  };
  const onMessageError = (): void => {
    rejectAll(new Error('ENA worker message could not be deserialized.'));
  };

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onMessageError);

  const cancel = (id: string): void => {
    worker.postMessage({ v: 1, kind: 'cancel', id });
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

      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => cancel(id);
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        runOptions.signal?.removeEventListener('abort', onAbort);
      };

      const request: PendingRequest = runOptions.onProgress
        ? { resolve, reject, onProgress: runOptions.onProgress, cleanup }
        : { resolve, reject, cleanup };
      pending.set(id, request);

      runOptions.signal?.addEventListener('abort', onAbort, { once: true });
      if (runOptions.timeoutMs !== undefined && Number.isFinite(runOptions.timeoutMs)) {
        timer = setTimeout(() => {
          cancel(id);
          settle(id)?.reject(new ENAWorkerCancelledError(id, `timed out after ${runOptions.timeoutMs}ms`));
        }, runOptions.timeoutMs);
      }

      const request_: ENAWorkerRequest = runOptions.chunkSize !== undefined
        ? { v: 1, kind: 'run', id, options, chunkSize: runOptions.chunkSize }
        : { v: 1, kind: 'run', id, options };
      try {
        worker.postMessage(request_);
      } catch (error) {
        settle(id)?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return {
      id,
      promise,
      cancel(): void {
        cancel(id);
      }
    };
  };

  return {
    run(options, runOptions): Promise<ENASet> {
      return start(options, runOptions).promise;
    },
    start,
    cancel,
    terminate(): void {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      rejectAll(new Error('ENA worker client terminated.'));
      worker.terminate?.();
    }
  };
}
