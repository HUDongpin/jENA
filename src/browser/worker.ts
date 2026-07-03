import { ena, type ENAOptions } from "../ena.js";

export interface ENAWorkerRequest {
  id: string;
  options: ENAOptions;
}

export interface ENAWorkerCancel {
  id: string;
  cancel: true;
}

export interface ENAWorkerResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  progress?: number;
  stage?: string;
}

const cancelled = new Set<string>();

self.addEventListener("message", (event: MessageEvent<ENAWorkerRequest | ENAWorkerCancel>) => {
  const message = event.data;
  if ("cancel" in message) {
    cancelled.add(message.id);
    return;
  }

  const { id, options } = message;
  try {
    self.postMessage({ id, ok: true, progress: 0, stage: "start" } satisfies ENAWorkerResponse);
    const result = ena(options);
    if (cancelled.has(id)) {
      cancelled.delete(id);
      return;
    }
    self.postMessage({ id, ok: true, result, progress: 1, stage: "complete" } satisfies ENAWorkerResponse);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies ENAWorkerResponse);
  }
});
