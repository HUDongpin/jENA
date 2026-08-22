import { describe, expect, it } from "vitest";
import { accumulateData, makeSet, projectIn } from "../src/index.js";
import type { Row } from "../src/index.js";
import { validateOrderedColumnNamespace } from "../src/core/orderedLimits.js";

function orderedOptions(rows: Row[], overrides: Partial<{
  units: string[];
  conversation: string[];
  codes: string[];
  metadata: string[];
}> = {}) {
  return {
    rows,
    units: overrides.units ?? ["unit"],
    conversation: overrides.conversation ?? ["horizon"],
    codes: overrides.codes ?? ["A", "B"],
    ...(overrides.metadata ? { metadata: overrides.metadata } : {}),
    networkType: "ordered" as const,
    windowSizeBack: 2
  };
}

function accumulatedOrderedData(codeCount: number, unitCount: number) {
  const codes = Array.from({ length: codeCount }, (_unused, index) => `C${index}`);
  const emptyCodes = Object.fromEntries(codes.map((code) => [code, 0]));
  const rows = Array.from({ length: unitCount }, (_unused, unitIndex) => [
    {
      unit: `u${unitIndex}`,
      horizon: "h1",
      ...emptyCodes,
      C0: 1
    },
    {
      unit: `u${unitIndex}`,
      horizon: "h1",
      ...emptyCodes,
      C1: 1
    }
  ]).flat();

  return accumulateData({
    rows,
    units: ["unit"],
    conversation: ["horizon"],
    codes,
    networkType: "ordered",
    windowSizeBack: 2
  });
}

describe("ordered namespace safety boundary", () => {
  it.each([
    { role: "units", overrides: { units: ["A"] } },
    { role: "conversation", overrides: { conversation: ["A"] } },
    { role: "metadata", overrides: { metadata: ["A"] } }
  ])(
    "rejects a code column reused by the $role namespace",
    ({ role, overrides }) => {
      const row: Row = { unit: "u1", horizon: "h1", A: 1, B: 0 };

      expect(() => accumulateData(orderedOptions([row], overrides)))
        .toThrowError(
          `Ordered code column "A" cannot also belong to the ${role} namespace; ` +
          "code and analytic identity/metadata roles must use distinct input columns."
        );
    }
  );

  it("rejects an edge header that collides with a unit column before reading code values", () => {
    let codeReads = 0;
    const row = {
      "A & A": "u1",
      horizon: "h1",
      get A() {
        codeReads += 1;
        return 1;
      },
      B: 0
    } as unknown as Row;

    expect(() => accumulateData(orderedOptions([row], { units: ["A & A"] })))
      .toThrowError(
        'Ordered adjacency header "A & A" collides with units column "A & A"; rename the input column or code label.'
      );
    expect(codeReads).toBe(0);
  });

  it("rejects a namespace collision before nested p-by-p header enumeration", () => {
    let iteratorRequests = 0;
    const codes = new Proxy(["A", "B"], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          iteratorRequests += 1;
          if (iteratorRequests > 2) {
            throw new Error("nested p-by-p header enumeration started before collision rejection");
          }
        }
        return Reflect.get(target, property, receiver);
      }
    });

    expect(() => validateOrderedColumnNamespace({
      codes,
      units: ["A & A"],
      conversation: []
    })).toThrowError(
      'Ordered adjacency header "A & A" collides with units column "A & A"; rename the input column or code label.'
    );
    expect(iteratorRequests).toBe(2);
  });

  it("rejects an edge header that collides with a conversation column", () => {
    const row: Row = { unit: "u1", "A & A": "h1", A: 1, B: 0 };

    expect(() => accumulateData(orderedOptions([row], { conversation: ["A & A"] })))
      .toThrowError(
        'Ordered adjacency header "A & A" collides with conversation column "A & A"; rename the input column or code label.'
      );
  });

  it("rejects an edge header that collides with a metadata column", () => {
    const row: Row = { unit: "u1", horizon: "h1", "A & A": "meta", A: 1, B: 0 };

    expect(() => accumulateData(orderedOptions([row], { metadata: ["A & A"] })))
      .toThrowError(
        'Ordered adjacency header "A & A" collides with metadata column "A & A"; rename the input column or code label.'
      );
  });

  it("rejects an edge header that collides with a raw code column", () => {
    const row: Row = { unit: "u1", horizon: "h1", A: 1, B: 0, "A & B": 1 };

    expect(() => accumulateData(orderedOptions([row], { codes: ["A", "B", "A & B"] })))
      .toThrowError(
        'Ordered adjacency header "A & B" collides with codes column "A & B"; rename the input column or code label.'
      );
  });

  it.each(["ENA_UNIT", "TRAJ_UNIT"])(
    "rejects reserved output column %s as an ordered input namespace",
    (reservedColumn) => {
      const row: Row = { [reservedColumn]: "u1", horizon: "h1", A: 1, B: 0 };

      expect(() => accumulateData(orderedOptions([row], { units: [reservedColumn] })))
        .toThrowError(
          `Ordered input column "${reservedColumn}" collides with reserved output column "${reservedColumn}".`
        );
    }
  );

  it("rejects a persisted ordered ENAData namespace that conflicts before modeling", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", A: 1, B: 0 },
      { unit: "u1", horizon: "h1", A: 0, B: 1 }
    ]));

    expect(() => makeSet({ ...data, units: ["A & A"] }))
      .toThrowError(
        'Ordered adjacency header "A & A" collides with units column "A & A"; rename the input column or code label.'
      );
  });

  it("rejects a persisted ordered metadata key that collides with an edge header", () => {
    const data = accumulateData(orderedOptions([
      { unit: "u1", horizon: "h1", topic: "t1", A: 1, B: 0 },
      { unit: "u1", horizon: "h1", topic: "t1", A: 0, B: 1 }
    ], { metadata: ["topic"] }));
    const tampered = {
      ...data,
      metaData: data.metaData.map((row) => ({ ...row, "A & A": "not-an-edge" }))
    };

    expect(() => makeSet(tampered))
      .toThrowError(
        'Ordered adjacency header "A & A" collides with metadata column "A & A"; rename the input column or code label.'
      );
  });
});

describe("ordered adjacency allocation budget", () => {
  it("rejects more than 12 codes before reading a p-by-p mask", () => {
    const codes = Array.from({ length: 13 }, (_unused, index) => `C${index}`);
    const unreadableMask = new Proxy([] as number[][], {
      get() {
        throw new Error("mask was read before the ordered adjacency budget");
      }
    });

    expect(() => accumulateData({
      rows: [{}],
      units: ["unit"],
      conversation: ["horizon"],
      codes,
      networkType: "ordered",
      mask: unreadableMask
    } as never)).toThrowError(
      "Ordered network analysis descriptive SVD budget allows at most 12 codes " +
      "(144 directed edges); got 13 codes (169 directed edges). " +
      "The verified Yu contract uses 7 codes, while 16/20-code probes are outside this safe bound."
    );
  });

  it("allows the 12-code directed-edge allocation boundary", () => {
    const codes = Array.from({ length: 12 }, (_unused, index) => `C${index}`);
    const row: Row = {
      unit: "u1",
      horizon: "h1",
      ...Object.fromEntries(codes.map((code) => [code, 0]))
    };

    const data = accumulateData({
      rows: [row],
      units: ["unit"],
      conversation: ["horizon"],
      codes,
      networkType: "ordered"
    });

    expect(data.codeColumns).toHaveLength(144);
  });
});

describe("ordered descriptive SVD resource budget", () => {
  it("rejects work above units times E-squared plus E-cubed before SVD", () => {
    const data = accumulatedOrderedData(12, 242);

    expect(() => makeSet(data)).toThrowError(
      "Ordered descriptive SVD work budget exceeded: units=242, edges=144, " +
      "estimated work=8004096 (units×E²+E³), limit=8000000."
    );
  });

  it("rejects the estimated dense matrix footprint even below the work limit", () => {
    const data = accumulatedOrderedData(12, 240);

    expect(() => makeSet(data)).toThrowError(
      "Ordered descriptive SVD matrix budget exceeded: units=240, edges=144, " +
      "estimated bytes=1050624 (8×(3×E²+2×units×E)), limit=1048576."
    );
  });

  it("keeps the verified 7-code, 87-unit Yu contract inside both budgets", () => {
    const data = accumulatedOrderedData(7, 87);

    const set = makeSet(data);

    expect(set.connectionMatrix).toHaveLength(87);
    expect(set.rotation.rotationMatrix).toHaveLength(49);
  });
});

describe("ordered descriptive SVD-only model boundary", () => {
  it("allows both the default and an explicit SVD rotation", () => {
    const data = accumulatedOrderedData(2, 3);

    const defaultSet = makeSet(data);
    const explicitSet = makeSet(data, { rotation: { method: "svd" } });

    expect(defaultSet.rotation.rotationColumns).toEqual(explicitSet.rotation.rotationColumns);
    expect(explicitSet.rotation.rotationColumns).toEqual(["SVD1", "SVD2", "SVD3", "SVD4"]);
  });

  it.each(["mean", "generalized", "regression", "regression2", "hena", "spherical"])(
    "rejects the custom %s rotation",
    (method) => {
      const data = accumulatedOrderedData(2, 3);

      expect(() => makeSet(data, { rotation: { method } as never })).toThrowError(
        `Ordered makeSet supports only the default or explicit "svd" rotation in the ` +
        `descriptive SVD-only phase; got "${method}".`
      );
    }
  );

  it.each([
    {
      method: "undirected",
      message: 'Ordered network analysis requires a directed node position method; got "undirected". Omit nodePositionMethod to use "directed".'
    },
    {
      method: "directed-ground-response",
      message: 'Ordered ENAData supports nodePositionMethod "directed"; "directed-ground-response" requires explicitly paired ground/response rows.'
    }
  ] as const)(
    "rejects $method before attempting SVD on an all-zero ordered matrix",
    ({ method, message }) => {
      const data = accumulateData(orderedOptions([
        { unit: "u1", horizon: "h1", A: 0, B: 0 }
      ]));

      expect(() => makeSet(data, { nodePositionMethod: method })).toThrowError(message);
    }
  );

  it("rejects an existing rotationSet", () => {
    const data = accumulatedOrderedData(2, 3);
    const rotationSet = makeSet(data).rotation;

    expect(() => makeSet(data, { rotationSet })).toThrowError(
      "Ordered makeSet does not accept rotationSet in the descriptive SVD-only phase."
    );
  });

  it("rejects projectIn for ordered ENAData", () => {
    const data = accumulatedOrderedData(2, 3);
    const set = makeSet(data);

    expect(() => projectIn(data, set)).toThrowError(
      "projectIn does not support ordered ENAData in the descriptive SVD-only phase."
    );
  });
});
