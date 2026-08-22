import { describe, expect, it } from "vitest";
import {
  accumulateData,
  accumulateDataChunked,
  createAccumulationStream
} from "../src/index.js";
import type { AccumulateOptions, ENAData, Row } from "../src/index.js";

const codes = ["A", "B"];

function optionsFor(rows: Row[], networkType: "ordered" | "standard"): AccumulateOptions {
  return {
    rows,
    units: ["unit"],
    conversation: ["horizon"],
    codes,
    networkType,
    weightBy: "sum"
  };
}

function edgeValue(data: ENAData, ground: string, response: string): number {
  const edge = data.adjacencyKey.find(
    (candidate) => candidate.source === ground && candidate.target === response
  );
  if (!edge) throw new Error(`Missing edge ${ground} -> ${response}.`);
  return Number(data.connectionCounts[0]?.[edge.name] ?? 0);
}

const accumulationModes: Array<{
  name: string;
  run: (options: AccumulateOptions) => ENAData;
}> = [
  {
    name: "batch",
    run: (options) => accumulateData(options)
  },
  {
    name: "chunked",
    run: (options) => accumulateDataChunked({ ...options, chunkSize: 1 })
  },
  {
    name: "stream",
    run: (options) => {
      const { rows, ...streamOptions } = options;
      const stream = createAccumulationStream(streamOptions);
      for (const row of rows) stream.push([row]);
      return stream.finish();
    }
  }
];

describe.each(accumulationModes)("ordered half-product stability through $name accumulation", ({ run }) => {
  it("keeps a representable MIN_VALUE half-product equal in both directions", () => {
    const data = run(optionsFor([
      { unit: "u1", horizon: "h1", A: Number.MIN_VALUE, B: 2 }
    ], "ordered"));

    const aToB = edgeValue(data, "A", "B");
    const bToA = edgeValue(data, "B", "A");
    expect(aToB).toBe(Number.MIN_VALUE);
    expect(bToA).toBe(Number.MIN_VALUE);
    expect(aToB).toBe(bToA);
  });

  it("continues to reject a true same-row half-product underflow", () => {
    expect(() => run(optionsFor([
      { unit: "u1", horizon: "h1", A: Number.MIN_VALUE, B: 1 }
    ], "ordered"))).toThrowError(
      /Ordered network analysis numeric underflow .* positive same-row operands .* produced 0\./
    );
  });

  it("continues to reject a true same-row half-product overflow", () => {
    expect(() => run(optionsFor([
      { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 4 }
    ], "ordered"))).toThrowError(
      /Ordered network analysis derived a non-finite connection .* got Infinity\./
    );
  });

  it("rejects non-finite ordered connections introduced by a finite directional mask", () => {
    expect(() => run({
      ...optionsFor([{ unit: "u1", horizon: "h1", A: 4, B: 4 }], "ordered"),
      mask: [
        [1, Number.MAX_VALUE],
        [1, 1]
      ]
    })).toThrowError(
      /Ordered network analysis derived a non-finite connection .* got Infinity\./
    );
  });

  it("rejects negative ordered directional-mask weights", () => {
    expect(() => run({
      ...optionsFor([{ unit: "u1", horizon: "h1", A: 2, B: 2 }], "ordered"),
      mask: [
        [1, -1],
        [1, 1]
      ]
    })).toThrowError(
      "Ordered network analysis mask[0][1] must be non-negative; got -1."
    );
  });

  it("fails closed when finite ordered row contributions overflow during unit aggregation", () => {
    expect(() => run(optionsFor(Array.from({ length: 3 }, () => ({
      unit: "u1",
      horizon: "h1",
      A: Number.MAX_VALUE,
      B: 1
    })), "ordered"))).toThrowError(
      /Ordered network analysis unit aggregation overflow .*\((?:A -> B|B -> A)\); got Infinity\./
    );
  });

  it("retains representable small ordered contributions regardless of horizon arrival order", () => {
    const rowsFor = (magnitudes: number[]): Row[] => magnitudes.flatMap((magnitude, index) => [
      { unit: "u1", horizon: `h${index}`, A: magnitude, B: 0 },
      { unit: "u1", horizon: `h${index}`, A: 0, B: 1 }
    ]);
    const largeFirst = run({
      ...optionsFor(rowsFor([1e16, 1, 1]), "ordered"),
      windowSizeBack: 2
    });
    const largeLast = run({
      ...optionsFor(rowsFor([1, 1, 1e16]), "ordered"),
      windowSizeBack: 2
    });

    expect(edgeValue(largeFirst, "A", "B")).toBe(10000000000000002);
    expect(edgeValue(largeLast, "A", "B")).toBe(10000000000000002);
  });

  it("correctly rounds the final ordered unit expansion at a half-even boundary", () => {
    const contributions = [
      0.29967579286516555,
      2.4386662459370223e-50,
      0.976921868996141
    ];
    const rows = contributions.flatMap((magnitude, index): Row[] => [
      { unit: "u1", horizon: `h${index}`, A: magnitude, B: 0 },
      { unit: "u1", horizon: `h${index}`, A: 0, B: 1 }
    ]);
    const data = run({
      ...optionsFor(rows, "ordered"),
      windowSizeBack: 2
    });

    expect(edgeValue(data, "A", "B")).toBe(1.2765976618613066);
  });

  it.each([
    { label: "negative", value: -1 },
    { label: "non-numeric", value: "not-a-count" },
    { label: "empty", value: "" },
    { label: "null", value: null },
    { label: "boolean", value: true }
  ])("rejects $label ordered raw code values instead of coercing them", ({ value }) => {
    expect(() => run(optionsFor([
      { unit: "u1", horizon: "h1", A: value, B: 1 }
    ], "ordered"))).toThrowError(
      /Ordered network analysis raw code value at row 0, column "A" must be a finite non-negative number or numeric string/
    );
  });

  it("accepts finite non-negative numeric strings for CSV-facing ordered callers", () => {
    const data = run(optionsFor([
      { unit: "u1", horizon: "h1", A: "2", B: "3" }
    ], "ordered"));

    expect(edgeValue(data, "A", "B")).toBe(3);
    expect(edgeValue(data, "B", "A")).toBe(3);
  });

  it("leaves the standard ENA product unhalved", () => {
    const data = run(optionsFor([
      { unit: "u1", horizon: "h1", A: Number.MIN_VALUE, B: 2 }
    ], "standard"));

    expect(data.connectionMatrix).toEqual([[Number.MIN_VALUE * 2]]);
  });

  it("leaves finite negative standard mask weights unchanged", () => {
    const data = run({
      ...optionsFor([{ unit: "u1", horizon: "h1", A: 2, B: 2 }], "standard"),
      mask: [
        [1, -1],
        [1, 1]
      ]
    });

    expect(data.connectionMatrix).toEqual([[-4]]);
  });
});
