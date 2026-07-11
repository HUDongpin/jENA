import { describe, expect, it } from "vitest";
import { ENAWorkerCancelledError, createENAWorkerClient } from "../../src/browser/client.js";
import type { ENAWorkerProgress } from "../../src/browser/client.js";
import { ena } from "../../src/index.js";
import type { Row } from "../../src/index.js";

// Real-browser worker round-trip (advisory F-014): the actual worker bundle
// runs in a genuine dedicated Worker inside Chromium, exercising structured
// clone and real message-queue timing rather than the in-memory shim used by
// the node-side protocol tests.

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_unused, index) => ({
    unit: `u${index % 6}`,
    conv: `c${index % 3}`,
    A: index % 2,
    B: (index + 1) % 2,
    C: index % 3 === 0 ? 1 : 0
  }));
}

const baseOptions = {
  units: ["unit"],
  conversation: ["conv"],
  codes: ["A", "B", "C"],
  windowSizeBack: 2
};

function makeWorker(): Worker {
  return new Worker(new URL("../../src/browser/worker.ts", import.meta.url), { type: "module" });
}

describe("real browser worker round-trip", () => {
  it("computes the same model as a direct call, with chunked progress", async () => {
    const worker = makeWorker();
    const client = createENAWorkerClient(worker);
    const options = { ...baseOptions, rows: makeRows(300) };
    const events: ENAWorkerProgress[] = [];
    const viaWorker = await client.run(options, { chunkSize: 25, onProgress: (progress) => events.push(progress) });
    const direct = ena(options);
    expect(viaWorker.unitLabels).toEqual(direct.unitLabels);
    expect(viaWorker.points).toEqual(direct.points);
    expect(viaWorker.variance).toEqual(direct.variance);
    expect(events.length).toBeGreaterThan(2);
    for (let index = 1; index < events.length; index += 1) {
      expect(events[index]!.progress).toBeGreaterThanOrEqual(events[index - 1]!.progress);
    }
    client.terminate();
  });

  it("cancels a running job mid-flight and stays reusable", async () => {
    const worker = makeWorker();
    const client = createENAWorkerClient(worker);
    const handle = client.start({ ...baseOptions, rows: makeRows(4000) }, {
      chunkSize: 10,
      onProgress: (progress) => {
        if (progress.progress > 0 && progress.progress < 0.3) handle.cancel();
      }
    });
    await expect(handle.promise).rejects.toBeInstanceOf(ENAWorkerCancelledError);
    const result = await client.run({ ...baseOptions, rows: makeRows(30) });
    expect(result.points.length).toBeGreaterThan(0);
    client.terminate();
  });

  it("propagates worker-side validation errors", async () => {
    const worker = makeWorker();
    const client = createENAWorkerClient(worker);
    await expect(client.run({ ...baseOptions, codes: ["A"], rows: makeRows(10) }))
      .rejects.toThrow(/codes must list at least 2/);
    client.terminate();
  });
});
