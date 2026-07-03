import {
  ena
} from "../chunk-RIVKHBY6.js";
import "../chunk-CS2S5LAI.js";

// src/browser/worker.ts
var cancelled = /* @__PURE__ */ new Set();
self.addEventListener("message", (event) => {
  const message = event.data;
  if ("cancel" in message) {
    cancelled.add(message.id);
    return;
  }
  const { id, options } = message;
  try {
    self.postMessage({ id, ok: true, progress: 0, stage: "start" });
    const result = ena(options);
    if (cancelled.has(id)) {
      cancelled.delete(id);
      return;
    }
    self.postMessage({ id, ok: true, result, progress: 1, stage: "complete" });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
//# sourceMappingURL=worker.js.map