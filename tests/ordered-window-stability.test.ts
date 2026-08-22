import { describe, expect, it } from "vitest";
import {
  accumulateData,
  accumulateDataChunked,
  createAccumulationStream
} from "../src/index.js";
import type { ENAData, Row } from "../src/index.js";

const codes = ["A", "B"];

function directFiniteWindowOracle(rows: Row[], windowSizeBack: number): number[][] {
  return rows.map((response, responseRowIndex) => {
    const priorRows = rows.slice(
      Math.max(0, responseRowIndex - (windowSizeBack - 1)),
      responseRowIndex
    );
    const prior = codes.map((code) => priorRows.reduce(
      (sum, row) => sum + Number(row[code] ?? 0),
      0
    ));
    const current = codes.map((code) => Number(response[code] ?? 0));
    return current.flatMap((responseValue, responseIndex) =>
      current.map((groundValue, groundIndex) => (
        (prior[groundIndex] ?? 0) * responseValue
        + (groundIndex === responseIndex ? 0 : 0.5 * groundValue * responseValue)
      ))
    );
  });
}

function rowMatrices(data: ENAData): number[][] {
  return data.rowConnectionCounts.map((row) =>
    data.codeColumns.map((column) => Number(row[column] ?? 0))
  );
}

describe("finite ordered window numerical stability", () => {
  it("rebuilds retained history after a huge expired count instead of cancelling a surviving count", () => {
    const rows: Row[] = [
      { unit: "u1", horizon: "h1", A: 1e16, B: 0 },
      { unit: "u1", horizon: "h1", A: 1, B: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 1 }
    ];
    const options = {
      rows,
      units: ["unit"],
      conversation: ["horizon"],
      codes,
      networkType: "ordered" as const,
      windowSizeBack: 2
    };
    const expected = directFiniteWindowOracle(rows, options.windowSizeBack);

    const batch = accumulateData(options);
    expect(rowMatrices(batch)).toEqual(expected);

    for (const chunkSize of [1, 2, rows.length]) {
      expect(rowMatrices(accumulateDataChunked({ ...options, chunkSize }))).toEqual(expected);
    }

    const stream = createAccumulationStream({ ...options, rows: [] });
    stream.push(rows.slice(0, 1));
    stream.push(rows.slice(1));
    expect(rowMatrices(stream.finish())).toEqual(expected);
  });
});
