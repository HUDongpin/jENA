import type { ENAOptions } from '../ena.js';
import type { ENASet } from '../types.js';
import type { ENAWorkerCancel, ENAWorkerRequest, ENAWorkerResponse } from './worker.js';

export interface ENAWorkerProgress {
  id: string;
  progress: number;
  stage?: string;
}

export interface ENAWorkerLike {
  postMessage(message: ENAWorkerRequest | ENAWorkerCancel): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ENAWorkerResponse>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<ENAWorkerResponse>) => void): void;
  terminate?: () => void;
}

export interface ENAWorkerRunHandle {
  id: string;
  promise: Promise<ENASet>;
  cancel(): void;
}

export interface ENAWorkerClient {
  run(options: ENAOptions, onProgress?: (progress: ENAWorkerProgress) => void): Promise<ENASet>;
  start(options: ENAOptions, onProgress?: (progress: ENAWorkerProgress) => void): ENAWorkerRunHandle;
  cancel(id: string): void;
  terminate(): void;
}

interface PendingRequest {
  resolve(result: ENASet): void;
  reject(error: Error): void;
  onProgress?: (progress: ENAWorkerProgress) => void;
}

let nextWorkerRequestId = 1;

function makeRequestId(): string {
  const id = `ena-worker-${nextWorkerRequestId}`;
  nextWorkerRequestId += 1;
  return id;
}

export function createENAWorkerClient(worker: ENAWorkerLike): ENAWorkerClient {
  const pending = new Map<string, PendingRequest>();
  const onMessage = (event: MessageEvent<ENAWorkerResponse>): void => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    if (response.progress !== undefined) {
      const progress: ENAWorkerProgress = response.stage === undefined
        ? { id: response.id, progress: response.progress }
        : { id: response.id, progress: response.progress, stage: response.stage };
      request.onProgress?.(progress);
    }
    if (response.result !== undefined) {
      pending.delete(response.id);
      request.resolve(response.result as ENASet);
      return;
    }
    if (!response.ok && response.error) {
      pending.delete(response.id);
      request.reject(new Error(response.error));
    }
  };
  worker.addEventListener('message', onMessage);

  const cancel = (id: string): void => {
    worker.postMessage({ id, cancel: true });
  };

  const start = (options: ENAOptions, onProgress?: (progress: ENAWorkerProgress) => void): ENAWorkerRunHandle => {
    const id = makeRequestId();
    const promise = new Promise<ENASet>((resolve, reject) => {
      const request: PendingRequest = onProgress ? { resolve, reject, onProgress } : { resolve, reject };
      pending.set(id, request);
      worker.postMessage({ id, options });
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
    run(options: ENAOptions, onProgress?: (progress: ENAWorkerProgress) => void): Promise<ENASet> {
      return start(options, onProgress).promise;
    },
    start,
    cancel,
    terminate(): void {
      worker.removeEventListener('message', onMessage);
      for (const request of pending.values()) request.reject(new Error('ENA worker client terminated.'));
      pending.clear();
      worker.terminate?.();
    }
  };
}
