import { describe, expect, it } from "vitest";
import { createENAWorkerHost } from "../src/browser/worker.js";
import type { ENAWorkerMessageEvent, ENAWorkerRequest, ENAWorkerResponse, ENAWorkerScope } from "../src/browser/worker.js";
import {
  DEFAULT_ENA_WORKER_MAX_PENDING_RUNS,
  ENAWorkerCancelledError,
  createENAWorkerClient
} from "../src/browser/client.js";
import type { ENAWorkerLike, ENAWorkerProgress } from "../src/browser/client.js";
import { ena } from "../src/index.js";
import type { ENASet, Row } from "../src/index.js";

// In-memory stand-in for a dedicated worker + its owning page: messages are
// structured-cloned (so unclonable payloads fail exactly like the real
// postMessage) and delivered as macrotasks (so cooperative cancellation has
// the same event-loop timing as a real worker).
function createWorkerPair(hostOptions?: { maxQueuedRuns?: number }) {
  const workerListeners: Array<(event: ENAWorkerMessageEvent<ENAWorkerRequest>) => void> = [];
  const responses: ENAWorkerResponse[] = [];
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
      responses.push(clone);
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

  createENAWorkerHost(scope, hostOptions);

  return {
    workerLike,
    responses,
    emitWorkerError(message: string) {
      for (const listener of clientListeners.error) listener({ message });
    },
    emitRawMessage(data: unknown) {
      for (const listener of clientListeners.message) listener({ data } as ENAWorkerMessageEvent<ENAWorkerResponse>);
    }
  };
}

interface ModelWorkerRecord {
  workerLike: ENAWorkerLike;
  terminated: boolean;
  messages: ENAWorkerRequest[];
}

/**
 * A controllable worker double that reaches the synchronous model stage and
 * then stalls long enough for cancellation or timeout to win; replacement
 * generations complete normally. This lets the client tests distinguish
 * promise-only cancellation from an actual terminate/recreate.
 */
function createModelWorkerFactory(result: ENASet) {
  const records: ModelWorkerRecord[] = [];

  const spawn = (): ENAWorkerLike => {
    const generation = records.length;
    const listeners = {
      message: [] as Array<(event: ENAWorkerMessageEvent<ENAWorkerResponse>) => void>,
      error: [] as Array<(event: unknown) => void>,
      messageerror: [] as Array<(event: unknown) => void>
    };
    const record = {
      workerLike: undefined as unknown as ENAWorkerLike,
      terminated: false,
      messages: [] as ENAWorkerRequest[]
    };
    const outstanding = new Set<string>();

    const emit = (message: ENAWorkerResponse, delayMs = 0): void => {
      setTimeout(() => {
        if (record.terminated) return;
        for (const listener of listeners.message) listener({ data: structuredClone(message) });
      }, delayMs);
    };

    const workerLike: ENAWorkerLike = {
      postMessage(message) {
        if (record.terminated) throw new Error("postMessage called on a terminated worker");
        record.messages.push(structuredClone(message));
        if (message.kind === "run") {
          outstanding.add(message.id);
          emit({ v: 1, kind: "progress", id: message.id, progress: 0.9, stage: "model" });
          // The first generation represents a long synchronous SVD. It does
          // eventually finish so a promise-only implementation fails quickly
          // rather than hanging the regression test.
          emit({ v: 1, kind: "result", id: message.id, result }, generation === 0 ? 80 : 0);
          return;
        }
        outstanding.delete(message.id);
        emit({ v: 1, kind: "cancelled", id: message.id });
      },
      addEventListener(type: "message" | "error" | "messageerror", listener: never) {
        listeners[type].push(listener);
      },
      removeEventListener(type: "message" | "error" | "messageerror", listener: never) {
        const list = listeners[type] as unknown[];
        const index = list.indexOf(listener);
        if (index >= 0) list.splice(index, 1);
      },
      terminate() {
        record.terminated = true;
        outstanding.clear();
      }
    };
    record.workerLike = workerLike;
    records.push(record);
    return workerLike;
  };

  return { records, spawn };
}

function createControlledWorker(options: { failRunPosts?: number } = {}) {
  const listeners = {
    message: [] as Array<(event: ENAWorkerMessageEvent<ENAWorkerResponse>) => void>,
    error: [] as Array<(event: unknown) => void>,
    messageerror: [] as Array<(event: unknown) => void>
  };
  const messages: ENAWorkerRequest[] = [];
  let failRunPosts = options.failRunPosts ?? 0;
  let terminated = false;

  const workerLike: ENAWorkerLike = {
    postMessage(message) {
      if (terminated) throw new Error("postMessage called on a terminated worker");
      if (message.kind === "run" && failRunPosts > 0) {
        failRunPosts -= 1;
        throw new Error("synthetic run post failure");
      }
      messages.push(structuredClone(message));
    },
    addEventListener(type: "message" | "error" | "messageerror", listener: never) {
      listeners[type].push(listener);
    },
    removeEventListener(type: "message" | "error" | "messageerror", listener: never) {
      const list = listeners[type] as unknown[];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
    terminate() {
      terminated = true;
    }
  };

  return {
    workerLike,
    messages,
    isTerminated: () => terminated,
    emit(message: ENAWorkerResponse): void {
      for (const listener of [...listeners.message]) listener({ data: structuredClone(message) });
    },
    emitError(message: string): void {
      for (const listener of [...listeners.error]) listener({ message });
    },
    emitMessageError(): void {
      for (const listener of [...listeners.messageerror]) listener({});
    }
  };
}

type PromiseOutcome<T> =
  | { status: "pending" }
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; error: unknown };

async function observePromise<T>(promise: Promise<T>): Promise<PromiseOutcome<T>> {
  const state: { outcome: PromiseOutcome<T> } = { outcome: { status: "pending" } };
  void promise.then(
    (value) => { state.outcome = { status: "fulfilled", value }; },
    (error: unknown) => { state.outcome = { status: "rejected", error }; }
  );
  await Promise.resolve();
  await Promise.resolve();
  return state.outcome;
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`condition was not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
  it("exports the client-side default pending-run admission limit", () => {
    expect(DEFAULT_ENA_WORKER_MAX_PENDING_RUNS).toBe(33);
  });

  it("rejects a runtime AbortSignal immediately after posting an instance-only cooperative cancel", async () => {
    const controlled = createControlledWorker();
    const client = createENAWorkerClient(controlled.workerLike);
    const controller = new AbortController();
    const handle = client.start({ ...baseOptions, rows: makeRows(20) }, { signal: controller.signal });

    try {
      controller.abort();
      const outcome = await observePromise(handle.promise);
      expect(outcome.status).toBe("rejected");
      expect(outcome.status === "rejected" && outcome.error).toBeInstanceOf(ENAWorkerCancelledError);
      expect(controlled.messages.at(-1)).toEqual({ v: 1, kind: "cancel", id: handle.id });
      expect(controlled.isTerminated()).toBe(false);
    } finally {
      client.terminate();
      await Promise.allSettled([handle.promise]);
    }
  });

  it("rejects handle.cancel immediately after posting an instance-only cooperative cancel", async () => {
    const controlled = createControlledWorker();
    const client = createENAWorkerClient(controlled.workerLike);
    const handle = client.start({ ...baseOptions, rows: makeRows(20) });

    try {
      handle.cancel();
      const outcome = await observePromise(handle.promise);
      expect(outcome.status).toBe("rejected");
      expect(outcome.status === "rejected" && outcome.error).toBeInstanceOf(ENAWorkerCancelledError);
      expect(controlled.messages.at(-1)).toEqual({ v: 1, kind: "cancel", id: handle.id });
      expect(controlled.isTerminated()).toBe(false);
    } finally {
      client.terminate();
      await Promise.allSettled([handle.promise]);
    }
  });

  it("rejects client.cancel immediately after posting an instance-only cooperative cancel", async () => {
    const controlled = createControlledWorker();
    const client = createENAWorkerClient(controlled.workerLike);
    const handle = client.start({ ...baseOptions, rows: makeRows(20) });

    try {
      client.cancel(handle.id);
      const outcome = await observePromise(handle.promise);
      expect(outcome.status).toBe("rejected");
      expect(outcome.status === "rejected" && outcome.error).toBeInstanceOf(ENAWorkerCancelledError);
      expect(controlled.messages.at(-1)).toEqual({ v: 1, kind: "cancel", id: handle.id });
      expect(controlled.isTerminated()).toBe(false);
    } finally {
      client.terminate();
      await Promise.allSettled([handle.promise]);
    }
  });

  it("rejects the 34th default pending run before postMessage and reuses a released slot", async () => {
    const controlled = createControlledWorker();
    const client = createENAWorkerClient(controlled.workerLike);
    const handles = Array.from({ length: 34 }, () =>
      client.start({ ...baseOptions, rows: makeRows(4) })
    );
    const completedSet = ena({ ...baseOptions, rows: makeRows(4) });

    try {
      const overflow = await observePromise(handles[33]!.promise);
      expect(overflow.status).toBe("rejected");
      expect(overflow.status === "rejected" ? String(overflow.error) : "").toMatch(/33 pending runs/);
      expect(controlled.messages.filter((message) => message.kind === "run")).toHaveLength(33);

      controlled.emit({ v: 1, kind: "result", id: handles[0]!.id, result: completedSet });
      await expect(handles[0]!.promise).resolves.toEqual(completedSet);

      const replacement = client.start({ ...baseOptions, rows: makeRows(4) });
      expect(controlled.messages.filter((message) => message.kind === "run")).toHaveLength(34);
      controlled.emit({ v: 1, kind: "result", id: replacement.id, result: completedSet });
      await expect(replacement.promise).resolves.toEqual(completedSet);
    } finally {
      client.terminate();
      await Promise.allSettled(handles.map((handle) => handle.promise));
    }
  });

  it("holds cooperative-cancel admission slots until the worker acknowledges a terminal response", async () => {
    const controlled = createControlledWorker();
    const client = createENAWorkerClient(controlled.workerLike);
    const cancelled = Array.from({ length: DEFAULT_ENA_WORKER_MAX_PENDING_RUNS }, () => {
      const handle = client.start({ ...baseOptions, rows: makeRows(4) });
      handle.cancel();
      return handle;
    });
    const completedSet = ena({ ...baseOptions, rows: makeRows(4) });

    try {
      const outcomes = await Promise.all(cancelled.map((handle) => observePromise(handle.promise)));
      expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);
      expect(controlled.messages.filter((message) => message.kind === "run"))
        .toHaveLength(DEFAULT_ENA_WORKER_MAX_PENDING_RUNS);

      const overflow = client.start({ ...baseOptions, rows: makeRows(4) });
      const overflowOutcome = await observePromise(overflow.promise);
      expect(overflowOutcome.status).toBe("rejected");
      expect(controlled.messages.filter((message) => message.kind === "run"))
        .toHaveLength(DEFAULT_ENA_WORKER_MAX_PENDING_RUNS);

      controlled.emit({ v: 1, kind: "cancelled", id: cancelled[0]!.id });
      const replacement = client.start({ ...baseOptions, rows: makeRows(4) });
      expect(controlled.messages.filter((message) => message.kind === "run"))
        .toHaveLength(DEFAULT_ENA_WORKER_MAX_PENDING_RUNS + 1);
      controlled.emit({ v: 1, kind: "result", id: replacement.id, result: completedSet });
      await expect(replacement.promise).resolves.toEqual(completedSet);
    } finally {
      client.terminate();
      await Promise.allSettled(cancelled.map((handle) => handle.promise));
    }
  });

  it("supports a configured zero pending-run limit without posting a run", async () => {
    const controlled = createControlledWorker();
    const client = createENAWorkerClient(controlled.workerLike, { maxPendingRuns: 0 });
    const handle = client.start({ ...baseOptions, rows: makeRows(4) });

    try {
      const outcome = await observePromise(handle.promise);
      expect(outcome.status).toBe("rejected");
      expect(controlled.messages).toHaveLength(0);
    } finally {
      client.terminate();
      await Promise.allSettled([handle.promise]);
    }
  });

  it("releases a reserved admission slot when posting a run fails", async () => {
    const controlled = createControlledWorker({ failRunPosts: 1 });
    const client = createENAWorkerClient(controlled.workerLike, { maxPendingRuns: 1 });
    const completedSet = ena({ ...baseOptions, rows: makeRows(4) });

    try {
      await expect(client.run({ ...baseOptions, rows: makeRows(4) }))
        .rejects.toThrow(/synthetic run post failure/);
      const replacement = client.start({ ...baseOptions, rows: makeRows(4) });
      const replacementSettled = Promise.allSettled([replacement.promise]);
      expect(controlled.messages.filter((message) => message.kind === "run")).toHaveLength(1);
      controlled.emit({ v: 1, kind: "result", id: replacement.id, result: completedSet });
      const [replacementOutcome] = await replacementSettled;
      expect(replacementOutcome).toEqual({ status: "fulfilled", value: completedSet });
    } finally {
      client.terminate();
    }
  });

  it.each(["error", "messageerror"] as const)(
    "releases all admission slots after a worker %s event",
    async (eventType) => {
      const controlled = createControlledWorker();
      const client = createENAWorkerClient(controlled.workerLike, { maxPendingRuns: 2 });
      const first = client.start({ ...baseOptions, rows: makeRows(4) });
      const second = client.start({ ...baseOptions, rows: makeRows(4) });
      const failed = Promise.allSettled([first.promise, second.promise]);
      const completedSet = ena({ ...baseOptions, rows: makeRows(4) });

      try {
        if (eventType === "error") controlled.emitError("boom");
        else controlled.emitMessageError();
        const outcomes = await failed;
        expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true);

        const replacement = client.start({ ...baseOptions, rows: makeRows(4) });
        const replacementSettled = Promise.allSettled([replacement.promise]);
        expect(controlled.messages.filter((message) => message.kind === "run")).toHaveLength(3);
        controlled.emit({ v: 1, kind: "result", id: replacement.id, result: completedSet });
        const [replacementOutcome] = await replacementSettled;
        expect(replacementOutcome).toEqual({ status: "fulfilled", value: completedSet });
      } finally {
        client.terminate();
        await failed;
      }
    }
  );

  it.each([-1, 1.5])("rejects invalid maxPendingRuns value %s", (maxPendingRuns) => {
    const controlled = createControlledWorker();
    let client: ReturnType<typeof createENAWorkerClient> | undefined;
    try {
      expect(() => {
        client = createENAWorkerClient(controlled.workerLike, { maxPendingRuns });
      }).toThrow(/maxPendingRuns must be a non-negative integer/);
    } finally {
      client?.terminate();
    }
  });

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

  it("cancelling a queued run removes and settles it before the active run completes", async () => {
    const { workerLike, responses } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const first = client.start({ ...baseOptions, rows: makeRows(100) }, { chunkSize: 1 });
    const second = client.start({ ...baseOptions, rows: makeRows(400) }, { chunkSize: 25 });
    second.cancel();
    await expect(second.promise).rejects.toBeInstanceOf(ENAWorkerCancelledError);
    expect(responses.some((response) => response.id === first.id && response.kind === "result")).toBe(false);
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

  it("drops a duplicate active run id without corrupting the original client request", async () => {
    const { workerLike, responses } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const originalOptions = { ...baseOptions, rows: makeRows(20) };
    const original = client.start(originalOptions, { chunkSize: 1 });
    const duplicate: ENAWorkerRequest = {
      v: 1,
      kind: "run",
      id: original.id,
      options: { ...baseOptions, rows: makeRows(2) }
    };

    try {
      workerLike.postMessage(duplicate);
      await expect(original.promise).resolves.toEqual(ena(originalOptions));
      expect(responses.filter((response) =>
        response.id === original.id && (response.kind === "result" || response.kind === "error")
      )).toHaveLength(1);
      expect(responses.some((response) =>
        response.id === original.id && response.kind === "error"
      )).toBe(false);
    } finally {
      client.terminate();
    }
  });

  it("drops a duplicate queued run id and preserves the originally queued payload", async () => {
    const { workerLike, responses } = createWorkerPair();
    const client = createENAWorkerClient(workerLike);
    const activeOptions = { ...baseOptions, rows: makeRows(20) };
    const queuedOptions = { ...baseOptions, rows: makeRows(2) };
    const active = client.start(activeOptions, { chunkSize: 1 });
    const queued = client.start(queuedOptions);

    try {
      workerLike.postMessage({
        v: 1,
        kind: "run",
        id: queued.id,
        options: { ...baseOptions, rows: makeRows(3) }
      });
      const [activeSet, queuedSet] = await Promise.all([active.promise, queued.promise]);
      expect(activeSet).toEqual(ena(activeOptions));
      expect(queuedSet).toEqual(ena(queuedOptions));
      expect(responses.filter((response) =>
        response.id === queued.id && (response.kind === "result" || response.kind === "error")
      )).toHaveLength(1);
      expect(responses.some((response) =>
        response.id === queued.id && response.kind === "error"
      )).toBe(false);
    } finally {
      client.terminate();
    }
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

  it("hard-stops a model-stage AbortSignal cancellation and recreates the worker", async () => {
    const recoveryOptions = { ...baseOptions, rows: makeRows(30) };
    const factory = createModelWorkerFactory(ena(recoveryOptions));
    const firstWorker = factory.spawn();
    const client = createENAWorkerClient(firstWorker, { workerFactory: factory.spawn });
    const controller = new AbortController();
    let reachedModel = false;

    try {
      const running = client.run({ ...baseOptions, rows: makeRows(300) }, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.stage !== "model") return;
          reachedModel = true;
          controller.abort();
        }
      });

      await expect(running).rejects.toBeInstanceOf(ENAWorkerCancelledError);
      expect(reachedModel).toBe(true);
      expect(factory.records[0]?.terminated).toBe(true);
      expect(factory.records).toHaveLength(2);

      const recovered = await client.run(recoveryOptions);
      expect(recovered.points).toEqual(ena(recoveryOptions).points);
    } finally {
      client.terminate();
    }
  });

  it("hard-stops a model-stage timeout and remains reusable with a worker factory", async () => {
    const recoveryOptions = { ...baseOptions, rows: makeRows(24) };
    const factory = createModelWorkerFactory(ena(recoveryOptions));
    const firstWorker = factory.spawn();
    const client = createENAWorkerClient(firstWorker, { workerFactory: factory.spawn });

    try {
      await expect(client.run({ ...baseOptions, rows: makeRows(300) }, { timeoutMs: 20 }))
        .rejects.toThrow(/timed out after 20ms/);
      expect(factory.records[0]?.terminated).toBe(true);
      expect(factory.records).toHaveLength(2);

      const recovered = await client.run(recoveryOptions);
      expect(recovered.points).toEqual(ena(recoveryOptions).points);
    } finally {
      client.terminate();
    }
  });

  it("settles every pending request when a model-stage cancellation restarts the worker", async () => {
    const recoveryOptions = { ...baseOptions, rows: makeRows(24) };
    const factory = createModelWorkerFactory(ena(recoveryOptions));
    const client = createENAWorkerClient(factory.spawn(), { workerFactory: factory.spawn, maxPendingRuns: 2 });
    let firstHandle: ReturnType<typeof client.start>;

    try {
      firstHandle = client.start({ ...baseOptions, rows: makeRows(300) }, {
        onProgress: (progress) => {
          if (progress.stage === "model") firstHandle.cancel();
        }
      });
      const queuedHandle = client.start({ ...baseOptions, rows: makeRows(40) });
      const firstOutcome = firstHandle.promise.then(
        () => ({ status: "fulfilled" as const }),
        (error: unknown) => ({ status: "rejected" as const, error })
      );
      const queuedOutcome = queuedHandle.promise.then(
        () => ({ status: "fulfilled" as const }),
        (error: unknown) => ({ status: "rejected" as const, error })
      );

      const [first, queued] = await Promise.all([firstOutcome, queuedOutcome]);
      expect(first.status).toBe("rejected");
      expect(first.status === "rejected" && first.error).toBeInstanceOf(ENAWorkerCancelledError);
      expect(queued.status).toBe("rejected");
      expect(queued.status === "rejected" ? String(queued.error) : "").toMatch(/restarted.*cancel/i);
      expect(factory.records[0]?.terminated).toBe(true);

      await expect(client.run(recoveryOptions)).resolves.toBeTruthy();
    } finally {
      client.terminate();
    }
  });

  it("bounds the waiting queue and releases ids after overflow, cancellation, and completion", async () => {
    const { workerLike, responses } = createWorkerPair({ maxQueuedRuns: 1 });
    const activeId = "bounded-active";
    const queuedId = "bounded-queued";
    const overflowId = "bounded-overflow";
    const run = (id: string, rows: number, chunkSize?: number): void => {
      workerLike.postMessage({
        v: 1,
        kind: "run",
        id,
        options: { ...baseOptions, rows: makeRows(rows) },
        ...(chunkSize === undefined ? {} : { chunkSize })
      });
    };

    try {
      run(activeId, 400, 1);
      run(queuedId, 20);
      run(overflowId, 20);
      await waitFor(() => responses.some((response) =>
        response.kind === "error" && response.id === overflowId && /queue limit of 1/.test(response.message)
      ));

      // Cancelling the queued request must drop its payload and release both
      // its queue slot and id immediately.
      workerLike.postMessage({ v: 1, kind: "cancel", id: queuedId });
      await waitFor(() => responses.some((response) => response.kind === "cancelled" && response.id === queuedId));
      run(overflowId, 20);
      workerLike.postMessage({ v: 1, kind: "cancel", id: activeId });
      await waitFor(() => responses.some((response) => response.kind === "result" && response.id === overflowId));

      // Completion and queued cancellation must also release ids for reuse.
      run(overflowId, 18);
      await waitFor(() => responses.filter((response) => response.kind === "result" && response.id === overflowId).length === 2);
      run(queuedId, 18);
      await waitFor(() => responses.some((response) => response.kind === "result" && response.id === queuedId));
    } finally {
      workerLike.postMessage({ v: 1, kind: "cancel", id: activeId });
      workerLike.postMessage({ v: 1, kind: "cancel", id: queuedId });
      workerLike.postMessage({ v: 1, kind: "cancel", id: overflowId });
    }
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
