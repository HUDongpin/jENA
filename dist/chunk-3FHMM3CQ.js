// src/browser/client.ts
var nextWorkerRequestId = 1;
function makeRequestId() {
  const id = `ena-worker-${nextWorkerRequestId}`;
  nextWorkerRequestId += 1;
  return id;
}
function createENAWorkerClient(worker) {
  const pending = /* @__PURE__ */ new Map();
  const onMessage = (event) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    if (response.progress !== void 0) {
      const progress = response.stage === void 0 ? { id: response.id, progress: response.progress } : { id: response.id, progress: response.progress, stage: response.stage };
      request.onProgress?.(progress);
    }
    if (response.result !== void 0) {
      pending.delete(response.id);
      request.resolve(response.result);
      return;
    }
    if (!response.ok && response.error) {
      pending.delete(response.id);
      request.reject(new Error(response.error));
    }
  };
  worker.addEventListener("message", onMessage);
  const cancel = (id) => {
    worker.postMessage({ id, cancel: true });
  };
  const start = (options, onProgress) => {
    const id = makeRequestId();
    const promise = new Promise((resolve, reject) => {
      const request = onProgress ? { resolve, reject, onProgress } : { resolve, reject };
      pending.set(id, request);
      worker.postMessage({ id, options });
    });
    return {
      id,
      promise,
      cancel() {
        cancel(id);
      }
    };
  };
  return {
    run(options, onProgress) {
      return start(options, onProgress).promise;
    },
    start,
    cancel,
    terminate() {
      worker.removeEventListener("message", onMessage);
      for (const request of pending.values()) request.reject(new Error("ENA worker client terminated."));
      pending.clear();
      worker.terminate?.();
    }
  };
}

export {
  createENAWorkerClient
};
//# sourceMappingURL=chunk-3FHMM3CQ.js.map