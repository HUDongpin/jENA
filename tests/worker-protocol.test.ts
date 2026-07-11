import { describe, expect, it } from "vitest";
import { createENAWorkerHost } from "../src/browser/worker.js";
import type { ENAWorkerMessageEvent, ENAWorkerRequest, ENAWorkerResponse, ENAWorkerScope } from "../src/browser/worker.js";
import { ENAWorkerCancelledError, createENAWorkerClient } from "../src/browser/client.js";
import type { ENAWorkerLike, ENAWorkerProgress } from "../src/browser/client.js";
import { ena } from "../src/index.js";
import type { Row } from "../src/index.js";

// In-memory stand-in for a dedicated worker + its owning page: messages are
// structured-cloned (so unclonable payloads fail exactly like the real
// postMessage) and delivered as macrotasks (so cooperative cancellation has
// the same event-loop timing as a real worker).
function createWorkerPair() {
  const workerListeners: Array<(event: ENAWorkerMessageEvent<ENAWorkerRequest>) => void> = [];
  const clientListeners = {
    message: [] as Array<(event: ENAWorkerMessageEvent<ENAWorkerResponse>) => void>,
    error: [] as Array<(event: unknown) => void>,
    messageerror: [] as Array<(event: unknown) => void>
  };

  const scope: ENAWorkerScope = {
    addEventListener(_type, listener) {
      workerListeners.push(listener);
    },
    postMessage(message) {
      const clone = structuredClone(message);
      setTimeout(() => {
        for (const listener of clientListeners.message) listener({ data: clone });
      }, 0);
    }
  };

  const workerLike: ENAWorkerLike = {
    postMessage(message) {
      const clone = structuredClone(message);
      setTimeout(() => {
        for (const listener of workerListeners) listener({ data: clone });
      }, 0);
    },
    addEventListener(type: "message" | "error" | "messageerror", listener: never) {
      clientListeners[type].push(listener);
    },
    removeEventListener(type: "message" | "error" | "messageerror", listener: never) {
      const list = clientListeners[type] as unknown[];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    }
  };

  createENAWorkerHost(scope);

  return {
    workerLike,
    emitWorkerError(message: string) {
      for (const listener of clientListeners.error) listener({ message });
    },
    emitRawMessage(data: unknown) {
      for (const listener of clientListeners.message) listener({ data } as ENAWorkerMessageEvent<ENAWorkerResponse>);
    }
  };
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_unused, index) => ({
    unit: `u${index % 7}`,
    conv: `c${index % 3}`,
    A: index % 2,
    B: (index + 1) % 2,
    C: index % 3 === 0 ? 1 : 0,
    D: index % 5 === 0 ? 1 : 0
  }));
}

const baseOptions = {
  units: ["unit"],
  conversation: ["conv"],
  codes: ["A", "B", "C", "D"],
  windowSizeBack: 2
};

describe("worker protocol v1 (advisory F-008)", () => {
  it("produces the same model as a direct ena() call", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const options = { ...baseOptions, rows: makeRows(40) };
    const [viaWorker, direct] = [await client.run(options), ena(options)];
    expect(viaWorker.unitLabels).toEqual(direct.unitLabels);
    expect(viaWorker.points).toEqual(direct.points);
    expect(viaWorker.variance).toEqual(direct.variance);
    expect(viaWorker.rotation.nodes).toEqual(direct.rotation.nodes);
    client.terminate();
  });

  it("reports monotonic chunked progress with more than two events", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const events: ENAWorkerProgress[] = [];
    await client.run({ ...baseOptions, rows: makeRows(600) }, {
      chunkSize: 50,
      onProgress: (progress) => events.push(progress)
    });
    expect(events.length).toBeGreaterThan(2);
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]!.progress).toBeGreaterThanOrEqual(events[index - 1]!.progress);
    }
    expect(events[0]?.progress).toBe(0);
    expect(events[0]?.stage).toBe("accumulate");
    expect(events.at(-1)?.progress).toBe(1);
    expect(events.at(-1)?.stage).toBe("model");
    client.terminate();
  });

  it("cancels mid-run at a chunk boundary and stays reusable", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    let progressEvents = 0;
    const handle = client.start({ ...baseOptions, rows: makeRows(2000) }, {
      chunkSize: 10,
      onProgress: () => {
        progressEvents += 1;
        if (progressEvents === 2) handle.cancel();
      }
    });
    await expect(handle.promise).rejects.toBeInstanceOf(ENAWorkerCancelledError);
    // Cancellation stopped the run long before all 200 chunks reported.
    expect(progressEvents).toBeLessThan(50);

    // The worker keeps serving after a cancelled run.
    const result = await client.run({ ...baseOptions, rows: makeRows(30) });
    expect(result.points.length).toBeGreaterThan(0);
    client.terminate();
  });

  it("cancelling a queued run settles it without executing", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const first = client.start({ ...baseOptions, rows: makeRows(400) }, { chunkSize: 25 });
    const second = client.start({ ...baseOptions, rows: makeRows(400) }, { chunkSize: 25 });
    second.cancel();
    await expect(second.promise).rejects.toBeInstanceOf(ENAWorkerCancelledError);
    await expect(first.promise).resolves.toBeTruthy();
    client.terminate();
  });

  it("runs queued requests to completion in order", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const small = client.run({ ...baseOptions, rows: makeRows(24) });
    const large = client.run({ ...baseOptions, rows: makeRows(120) }, { chunkSize: 30 });
    const [smallSet, largeSet] = await Promise.all([small, large]);
    expect(smallSet.points).toEqual(ena({ ...baseOptions, rows: makeRows(24) }).points);
    expect(largeSet.points).toEqual(ena({ ...baseOptions, rows: makeRows(120) }).points);
    client.terminate();
  });

  it("rejects every pending run when the worker crashes", async () => {
    const { workerLike, emitWorkerError } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const running = client.run({ ...baseOptions, rows: makeRows(500) }, { chunkSize: 20 });
    const expectation = expect(running).rejects.toThrow(/ENA worker failed: boom/);
    emitWorkerError("boom");
    await expectation;
    client.terminate();
  });

  it("times out and cancels the worker-side run", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    await expect(
      client.run({ ...baseOptions, rows: makeRows(5000) }, { chunkSize: 5, timeoutMs: 20 })
    ).rejects.toThrow(/timed out after 20ms/);
    // Worker remains usable after the timed-out run was cancelled.
    const result = await client.run({ ...baseOptions, rows: makeRows(30) });
    expect(result.points.length).toBeGreaterThan(0);
    client.terminate();
  });

  it("honors AbortSignal, including pre-aborted signals", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(client.run({ ...baseOptions, rows: makeRows(30) }, { signal: preAborted.signal }))
      .rejects.toBeInstanceOf(ENAWorkerCancelledError);

    const controller = new AbortController();
    const running = client.run({ ...baseOptions, rows: makeRows(2000) }, {
      chunkSize: 10,
      signal: controller.signal,
      onProgress: () => controller.abort()
    });
    await expect(running).rejects.toBeInstanceOf(ENAWorkerCancelledError);
    client.terminate();
  });

  it("propagates validation errors from the worker as rejections", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    await expect(client.run({ ...baseOptions, codes: ["A"], rows: makeRows(10) }))
      .rejects.toThrow(/codes must list at least 2/);
    await expect(client.run({ ...baseOptions, rows: [] }))
      .rejects.toThrow(/rows is empty/);
    client.terminate();
  });

  it("rejects function weightBy at compile time and at runtime", () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const withFunction = { ...baseOptions, rows: makeRows(10), weightBy: (values: number[]) => values[0] ?? 0 };
    // @ts-expect-error weightBy functions cannot cross the worker boundary
    expect(() => client.start(withFunction)).toThrow(TypeError);
    client.terminate();
  });

  it("ignores malformed and unversioned messages", async () => {
    const { workerLike, emitRawMessage } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const handle = client.start({ ...baseOptions, rows: makeRows(40) });
    emitRawMessage(null);
    emitRawMessage("garbage");
    emitRawMessage({ v: 99, kind: "result", id: handle.id, result: {} });
    emitRawMessage({ v: 1, kind: "result", id: handle.id, result: { not: "a set" } });
    // The malformed v1 result for our id rejects the run (protocol error)...
    await expect(handle.promise).rejects.toThrow(/malformed result payload/);
    // ...but the client and worker stay healthy for subsequent runs.
    const result = await client.run({ ...baseOptions, rows: makeRows(24) });
    expect(result.points.length).toBeGreaterThan(0);
    client.terminate();
  });

  it("terminate rejects in-flight runs", async () => {
    const { workerLike } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const running = client.run({ ...baseOptions, rows: makeRows(500) }, { chunkSize: 20 });
    const expectation = expect(running).rejects.toThrow(/terminated/);
    client.terminate();
    await expectation;
  });
});
