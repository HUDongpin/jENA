import { describe, expect, it } from "vitest";
import { accumulateDataChunked, createAccumulationStream } from "../src/index.js";
import type { Row } from "../src/index.js";

const rows: Row[] = [
  { unit: "u1", horizon: "h1", A: 1, B: 0 },
  { unit: "u1", horizon: "h1", A: 0, B: 1 }
];

describe("accumulation stream disposal", () => {
  it("disposes after a successful finish without clearing the returned result", () => {
    const stream = createAccumulationStream({
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      windowSizeBack: 2
    });
    stream.push(rows);

    const result = stream.finish();

    expect(stream.state).toMatchObject({
      isFinished: true,
      isDisposed: true,
      activeConversations: 0,
      activeBufferedRows: 0
    });
    expect(result.rawRows).toHaveLength(2);
    expect(result.rowConnectionCounts).toHaveLength(2);
    expect(result.connectionCounts).toHaveLength(1);
  });

  it("reports a disposed terminal snapshot to the final progress callback", () => {
    const terminalStates: Array<{
      progress: number;
      isFinished: boolean;
      isDisposed: boolean;
      activeConversations: number;
      activeBufferedRows: number;
    }> = [];
    const stream = createAccumulationStream({
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      windowSizeBack: 2,
      onProgress: (progress, state) => {
        if (progress === 1) {
          terminalStates.push({
            progress,
            isFinished: state.isFinished,
            isDisposed: state.isDisposed,
            activeConversations: state.activeConversations,
            activeBufferedRows: state.activeBufferedRows
          });
        }
      }
    });
    stream.push(rows);

    stream.finish();

    expect(terminalStates).toEqual([{
      progress: 1,
      isFinished: true,
      isDisposed: true,
      activeConversations: 0,
      activeBufferedRows: 0
    }]);
  });

  it("supports deterministic idempotent disposal and rejects later use", () => {
    const stream = createAccumulationStream({
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      windowSizeBack: 2
    });
    stream.push(rows.slice(0, 1));

    stream.dispose();
    stream.dispose();

    expect(stream.state).toMatchObject({
      isFinished: true,
      isDisposed: true,
      activeConversations: 0,
      activeBufferedRows: 0
    });
    expect(() => stream.push(rows.slice(1))).toThrow("Cannot push rows after accumulation stream has finished.");
    expect(() => stream.finish()).toThrow("Accumulation stream has already finished.");
  });

  it("emits exactly one terminal progress event through the chunked wrapper", () => {
    const progress: number[] = [];

    accumulateDataChunked({
      rows,
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      windowSizeBack: 2,
      chunkSize: 1,
      onProgress: (value) => progress.push(value)
    });

    expect(progress.at(0)).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.filter((value) => value === 1)).toHaveLength(1);
  });

  it("disposes when the terminal progress callback throws", () => {
    const callbackError = new Error("terminal progress failed");
    const stream = createAccumulationStream({
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      windowSizeBack: 2,
      onProgress: (progress) => {
        if (progress === 1) throw callbackError;
      }
    });
    stream.push(rows);

    expect(() => stream.finish()).toThrow(callbackError);
    expect(stream.state).toMatchObject({
      isFinished: true,
      isDisposed: true,
      activeConversations: 0,
      activeBufferedRows: 0
    });
    expect(() => stream.push(rows)).toThrow("Cannot push rows after accumulation stream has finished.");
  });

  it("disposes after a row-validation failure instead of retaining partial state", () => {
    const stream = createAccumulationStream({
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      windowSizeBack: 2
    });

    expect(() => stream.push([{ unit: "u1", horizon: "h1", A: 1 }]))
      .toThrow("rows are missing required columns: B");
    expect(stream.state).toMatchObject({
      isFinished: true,
      isDisposed: true,
      activeConversations: 0,
      activeBufferedRows: 0
    });
    expect(() => stream.finish()).toThrow("Accumulation stream has already finished.");
  });

  it("disposes when a push progress callback throws", () => {
    const callbackError = new Error("push progress failed");
    const stream = createAccumulationStream({
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      windowSizeBack: 2,
      expectedRows: rows.length,
      onProgress: () => {
        throw callbackError;
      }
    });

    expect(() => stream.push(rows.slice(0, 1))).toThrow(callbackError);
    expect(stream.state).toMatchObject({
      rowsSeen: 1,
      isFinished: true,
      isDisposed: true,
      activeConversations: 0,
      activeBufferedRows: 0
    });
    expect(() => stream.push(rows.slice(1))).toThrow("Cannot push rows after accumulation stream has finished.");
  });

  it("disposes when finish fails", () => {
    const stream = createAccumulationStream({
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      windowSizeBack: 2,
      unitsUsed: ["not-present"]
    });
    stream.push(rows);

    expect(() => stream.finish()).toThrow(/unitsUsed did not match any accumulated units/);
    expect(stream.state).toMatchObject({
      isFinished: true,
      isDisposed: true,
      activeConversations: 0,
      activeBufferedRows: 0
    });
  });

  it("copies stream configuration instead of retaining or rereading the caller options", () => {
    const units = ["unit"];
    const conversation = ["horizon"];
    const codes = ["A", "B"];
    const revocable = Proxy.revocable({
      units,
      conversation,
      codes,
      windowSizeBack: 2
    }, {});
    const stream = createAccumulationStream(revocable.proxy);

    revocable.revoke();
    units[0] = "mutated-unit";
    conversation[0] = "mutated-horizon";
    codes[0] = "mutated-code";
    stream.push(rows);
    const result = stream.finish();

    expect(result.units).toEqual(["unit"]);
    expect(result.conversation).toEqual(["horizon"]);
    expect(result.codes).toEqual(["A", "B"]);
    expect(result.connectionCounts).toHaveLength(1);
  });

  it("releases model-only initial rows while preserving their ordered model and provenance", () => {
    const initialRows = rows.map((row) => ({ ...row }));
    const stream = createAccumulationStream({
      rows: initialRows,
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      networkType: "ordered",
      windowSizeBack: 2,
      materialization: "model"
    });

    initialRows[0]!.A = 99;
    initialRows.splice(0);
    const result = stream.finish();

    expect(stream.state).toMatchObject({ isFinished: true, isDisposed: true });
    expect(result.rawRows).toEqual([]);
    expect(result.rowConnectionCounts).toEqual([]);
    expect(result.connectionMatrix).toEqual([[0, 0, 1, 0]]);
    expect(result.rowWindowProvenance).toHaveLength(2);
  });
});
