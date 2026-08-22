import { describe, expect, it } from "vitest";
import {
  accumulateData,
  accumulateDataChunked,
  createAccumulationStream
} from "../src/index.js";
import type { AccumulateOptions, ENAData, Row } from "../src/index.js";

type AccumulationMode = "batch" | "chunked" | "stream";

function runOrdered(
  mode: AccumulationMode,
  rows: Row[],
  windowSizeBack: number,
  overrides: Partial<AccumulateOptions> = {}
): ENAData {
  const options: AccumulateOptions = {
    rows,
    units: ["unit"],
    conversation: ["horizon"],
    codes: ["A", "B"],
    networkType: "ordered",
    windowSizeBack,
    ...overrides
  };
  if (mode === "batch") return accumulateData(options);
  if (mode === "chunked") return accumulateDataChunked({ ...options, chunkSize: 1 });
  const { rows: _rows, ...streamOptions } = options;
  const stream = createAccumulationStream(streamOptions);
  for (const row of rows) stream.push([row]);
  return stream.finish();
}

function orderedRowEdge(data: ENAData, rowIndex: number, ground: string, response: string): number {
  const edge = data.adjacencyKey.find((entry) => entry.source === ground && entry.target === response);
  if (!edge) throw new Error(`Missing ordered edge ${ground} -> ${response}.`);
  return Number(data.rowConnectionCounts[rowIndex]?.[edge.name]);
}

const halfEvenPriorValues = [
  0.29967579286516555,
  2.4386662459370223e-50,
  0.976921868996141
];

function halfEvenRows(prefix: number[] = []): Row[] {
  return [...prefix, ...halfEvenPriorValues].map((A) => ({
    unit: "u1", horizon: "h1", A, B: 0
  })).concat({ unit: "u1", horizon: "h1", A: 0, B: 1 });
}

const invalidIdentityValues: Array<{ label: string; value: unknown; displayed: string }> = [
  { label: "undefined", value: undefined, displayed: "undefined" },
  { label: "object", value: { id: 1 }, displayed: "object" },
  { label: "bigint", value: 1n, displayed: "bigint" },
  { label: "symbol", value: Symbol("identity"), displayed: "symbol" },
  { label: "NaN", value: Number.NaN, displayed: "NaN" },
  { label: "Infinity", value: Number.POSITIVE_INFINITY, displayed: "Infinity" }
];

const orderedIdentityFields = [
  { label: "unit", column: "unit", kind: "unit" },
  { label: "conversation", column: "horizon", kind: "conversation" },
  { label: "metadata", column: "meta", kind: "metadata" }
] as const;

describe("ordered runtime and numerical boundaries", () => {
  it("throws as soon as a monotone unit aggregate overflows", () => {
    let consumedRows = 0;
    const rows = Array.from({ length: 10_000 }, (_unused, index) => {
      const row = {
        unit: "u1",
        horizon: `h${index}`,
        get A() {
          consumedRows += 1;
          return Number.MAX_VALUE;
        },
        B: 1
      };
      return row as unknown as Row;
    });

    expect(() => accumulateData({
      rows,
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      networkType: "ordered"
    })).toThrowError(
      /Ordered network analysis unit aggregation overflow .*\((?:A -> B|B -> A)\); got Infinity\./
    );

    expect(consumedRows).toBe(3);
  });

  it.each(["batch", "chunked", "stream"] as const)(
    "correctly rounds an Infinity-window prior expansion through %s accumulation",
    (mode) => {
      const rows = halfEvenRows();
      const data = runOrdered(mode, rows, Number.POSITIVE_INFINITY);

      expect(orderedRowEdge(data, rows.length - 1, "A", "B"))
        .toBe(1.2765976618613066);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "correctly rounds a finite-window prior expansion after eviction through %s accumulation",
    (mode) => {
      const rows = halfEvenRows([1e16]);
      const data = runOrdered(mode, rows, 4);

      expect(orderedRowEdge(data, rows.length - 1, "A", "B"))
        .toBe(1.2765976618613066);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "short-circuits zero-masked ordered edges before overflowing through %s accumulation",
    (mode) => {
      const data = runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 4 }
      ], 1, {
        mask: [[1, 0], [0, 1]]
      });

      expect(data.connectionMatrix).toEqual([[0, 0, 0, 0]]);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "scales an overflowing finite-window prior expansion before multiplying through %s accumulation",
    (mode) => {
      const data = runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 0 },
        { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 0 },
        { unit: "u1", horizon: "h1", A: 0, B: 0.25 }
      ], 3, {
        mask: [[0, 1], [1, 1]]
      });

      expect(orderedRowEdge(data, 2, "A", "B")).toBe(Number.MAX_VALUE * 0.5);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "short-circuits a zero response against an overflowing prior expansion through %s accumulation",
    (mode) => {
      const data = runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 0 },
        { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 0 },
        { unit: "u1", horizon: "h1", A: 0, B: 0 }
      ], 3, {
        mask: [[0, 1], [1, 1]]
      });

      expect(orderedRowEdge(data, 2, "A", "B")).toBe(0);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "applies a fractional mask before two finite edge contributions overflow through %s accumulation",
    (mode) => {
      const data = runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: Number.MAX_VALUE / 2, B: 0 },
        { unit: "u2", horizon: "h1", A: Number.MAX_VALUE, B: 2 }
      ], 2, {
        mask: [[0, 0.25], [1, 1]]
      });

      expect(orderedRowEdge(data, 1, "A", "B")).toBe(Number.MAX_VALUE / 2);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "rescales an overflowing lagged product through a fractional mask in %s accumulation",
    (mode) => {
      const data = runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 0 },
        { unit: "u2", horizon: "h1", A: 0, B: 2 }
      ], 2, {
        mask: [[0, 0.25], [1, 1]]
      });

      expect(orderedRowEdge(data, 1, "A", "B")).toBe(Number.MAX_VALUE / 2);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "rescales an overflowing same-row half product through a fractional mask in %s accumulation",
    (mode) => {
      const data = runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: Number.MAX_VALUE, B: 4 }
      ], 1, {
        mask: [[0, 0.25], [0, 1]]
      });

      expect(orderedRowEdge(data, 0, "A", "B")).toBe(Number.MAX_VALUE / 2);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "masks the larger lagged operand before subnormal rounding can be amplified in %s accumulation",
    (mode) => {
      const data = runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: 2.5, B: 0 },
        { unit: "u2", horizon: "h1", A: 0, B: Number.MAX_VALUE }
      ], 2, {
        mask: [[0, Number.MIN_VALUE], [0, 0]]
      });

      expect(orderedRowEdge(data, 1, "A", "B"))
        .toBe((Number.MAX_VALUE * Number.MIN_VALUE) * 2.5);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "masks the larger same-row operand before subnormal rounding can be amplified in %s accumulation",
    (mode) => {
      const data = runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: 2.5, B: Number.MAX_VALUE }
      ], 1, {
        mask: [[0, Number.MIN_VALUE], [0, 0]]
      });

      expect(orderedRowEdge(data, 0, "A", "B"))
        .toBe(((Number.MAX_VALUE * Number.MIN_VALUE) * 0.5) * 2.5);
    }
  );

  it.each(["batch", "chunked", "stream"] as const)(
    "rejects a positive ordered mask product that underflows through %s accumulation",
    (mode) => {
      expect(() => runOrdered(mode, [
        { unit: "u1", horizon: "h1", A: 1, B: 1 }
      ], 1, {
        mask: [[1, Number.MIN_VALUE], [1, 1]]
      })).toThrowError(
        /Ordered network analysis mask underflow at edge index 2 \(A -> B\): positive connection 0.5 and mask weight 5e-324 produced 0\./
      );
    }
  );

  it("continues to reject a positive ordered mask product that overflows", () => {
    expect(() => runOrdered("batch", [
      { unit: "u1", horizon: "h1", A: 4, B: 4 }
    ], 1, {
      mask: [[1, Number.MAX_VALUE], [1, 1]]
    })).toThrowError(
      /Ordered network analysis derived a non-finite connection .* got Infinity\./
    );
  });

  for (const field of orderedIdentityFields) {
    it.each(invalidIdentityValues)(
      `rejects $label ${field.label} values at the JavaScript runtime boundary`,
      ({ value, displayed }) => {
        const row = {
          unit: "u1",
          horizon: "h1",
          meta: "stable",
          A: 1,
          B: 1,
          [field.column]: value
        } as unknown as Row;

        expect(() => accumulateData({
          rows: [row],
          units: ["unit"],
          conversation: ["horizon"],
          codes: ["A", "B"],
          metadata: ["meta"],
          networkType: "ordered"
        })).toThrowError(
          new RegExp(
            `Ordered network analysis ${field.kind} identity value at row 0, column "${field.column}" ` +
            `must be a string, finite number, boolean, or null; got ${displayed}\\.`
          )
        );
      }
    );
  }

  it.each(["batch", "chunked", "stream"] as const)(
    "rejects an undeclared raw key that collides with a generated ordered edge header through %s accumulation",
    (mode) => {
      let codeReads = 0;
      const rows = [
        {
          unit: "u1",
          horizon: "h1",
          get A() {
            codeReads += 1;
            return 1;
          },
          B: 0
        },
        {
          unit: "u1",
          horizon: "h1",
          get A() {
            codeReads += 1;
            return 0;
          },
          B: 1,
          "A & B": "untrusted raw value"
        }
      ] as unknown as Row[];

      expect(() => runOrdered(mode, rows, 2)).toThrowError(
        'Ordered network analysis raw row 1 key "A & B" collides with generated edge header "A & B".'
      );
      expect(codeReads).toBe(1);
    }
  );
});
