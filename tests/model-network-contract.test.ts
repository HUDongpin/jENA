import { describe, expect, it } from "vitest";
import { accumulateData, makeSet, projectIn } from "../src/index.js";
import type { ENAData, Row } from "../src/index.js";

const rows: Row[] = [
  { unit: "u1", horizon: "h1", A: 1, B: 0 },
  { unit: "u1", horizon: "h1", A: 0, B: 1 },
  { unit: "u2", horizon: "h2", A: 0, B: 1 },
  { unit: "u2", horizon: "h2", A: 1, B: 0 }
];

function orderedData(): ENAData {
  return accumulateData({
    rows,
    units: ["unit"],
    conversation: ["horizon"],
    codes: ["A", "B"],
    networkType: "ordered",
    windowSizeBack: 2
  });
}

describe("makeSet ENAData network contract", () => {
  it("rejects an unknown runtime data networkType before modeling", () => {
    const tampered = { ...orderedData(), networkType: "mystery" as never };
    expect(() => makeSet(tampered)).toThrowError(
      'ENAData networkType must be one of standard, ordered; got "mystery".'
    );
  });

  it("rejects an unknown runtime modelType", () => {
    const tampered = { ...orderedData(), modelType: "Trajectory" as never };
    expect(() => makeSet(tampered)).toThrowError(
      'ENAData modelType must be one of EndPoint, AccumulatedTrajectory, SeparateTrajectory; got "Trajectory".'
    );
  });

  it("rejects modelType and functionParams.model disagreement", () => {
    const data = orderedData();
    const tampered: ENAData = {
      ...data,
      functionParams: { ...data.functionParams, model: "AccumulatedTrajectory" }
    };
    expect(() => makeSet(tampered)).toThrowError(
      'ENAData modelType "EndPoint" does not match functionParams.model "AccumulatedTrajectory".'
    );
  });

  it("rejects ordered trajectory data even when both model fields agree", () => {
    const data = orderedData();
    const tampered: ENAData = {
      ...data,
      modelType: "SeparateTrajectory",
      functionParams: { ...data.functionParams, model: "SeparateTrajectory" }
    };
    expect(() => makeSet(tampered)).toThrowError(
      'Ordered ENAData requires modelType and functionParams.model to be "EndPoint".'
    );
  });

  it("rejects data and functionParams networkType disagreement", () => {
    const data = orderedData();
    const tampered: ENAData = {
      ...data,
      functionParams: { ...data.functionParams, networkType: "standard" }
    };
    expect(() => makeSet(tampered)).toThrowError(
      'ENAData networkType "ordered" does not match functionParams.networkType "standard".'
    );
  });

  it.each([
    {
      name: "Conversation window",
      patch: { window: "Conversation" as const },
      message: 'Ordered ENAData requires functionParams.window "MovingStanzaWindow"; got "Conversation".'
    },
    {
      name: "zero backward window",
      patch: { windowSizeBack: 0 },
      message: 'Ordered ENAData requires functionParams.windowSizeBack to be an integer >= 1 or Infinity; got 0.'
    },
    {
      name: "forward window",
      patch: { windowSizeForward: 1 },
      message: 'Ordered ENAData requires functionParams.windowSizeForward 0; got 1.'
    },
    {
      name: "binary weighting",
      patch: { weightBy: "binary" as const },
      message: 'Ordered ENAData requires functionParams.weightBy "sum"; got "binary".'
    }
  ])("rejects ordered $name", ({ patch, message }) => {
    const data = orderedData();
    const tampered = {
      ...data,
      functionParams: { ...data.functionParams, ...patch }
    } as ENAData;
    expect(() => makeSet(tampered)).toThrowError(message);
  });

  it("rejects malformed ordered codeColumns width", () => {
    const data = orderedData();
    const tampered: ENAData = { ...data, codeColumns: data.codeColumns.slice(0, 3) };
    expect(() => makeSet(tampered)).toThrowError(
      'Ordered ENAData codeColumns must contain 4 column-major directed headers for 2 codes; got 3.'
    );
  });

  it("rejects malformed ordered adjacency key order", () => {
    const data = orderedData();
    const tampered: ENAData = {
      ...data,
      adjacencyKey: [data.adjacencyKey[1]!, data.adjacencyKey[0]!, ...data.adjacencyKey.slice(2)]
    };
    expect(() => makeSet(tampered)).toThrowError(
      'Ordered ENAData adjacencyKey entry 0 does not match the required column-major ground-to-response key.'
    );
  });

  it("rejects malformed ordered connectionMatrix width", () => {
    const data = orderedData();
    const tampered: ENAData = {
      ...data,
      connectionMatrix: data.connectionMatrix.map((row) => row.slice(0, 3))
    };
    expect(() => makeSet(tampered)).toThrowError(
      'Ordered ENAData connectionMatrix row 0 must contain 4 directed cells; got 3.'
    );
  });

  it("rejects ordered row-count disagreement before matrix modeling", () => {
    const data = orderedData();
    const tampered: ENAData = {
      ...data,
      connectionCounts: data.connectionCounts.slice(0, 1)
    };
    expect(() => makeSet(tampered)).toThrowError(
      'Ordered ENAData row counts must agree: connectionMatrix has 2 rows, connectionCounts has 1, and unitLabels has 2.'
    );
  });

  it("rejects non-array ordered connectionCounts", () => {
    const data = orderedData();
    const tampered = { ...data, connectionCounts: null as never };
    expect(() => makeSet(tampered)).toThrowError(
      'Ordered ENAData connectionCounts must be an array of directed count rows.'
    );
  });

  it("rejects truncated ordered unit labels before matrix modeling", () => {
    const data = orderedData();
    const tampered: ENAData = {
      ...data,
      unitLabels: data.unitLabels.slice(0, 1)
    };
    expect(() => makeSet(tampered)).toThrowError(
      'Ordered ENAData row counts must agree: connectionMatrix has 2 rows, connectionCounts has 2, and unitLabels has 1.'
    );
  });

  it("rejects an ordered connectionCounts row missing a directional column", () => {
    const data = orderedData();
    const missingColumn = data.codeColumns[0]!;
    const firstRow = Object.fromEntries(
      Object.entries(data.connectionCounts[0]!).filter(([column]) => column !== missingColumn)
    ) as Row;
    const tampered: ENAData = {
      ...data,
      connectionCounts: [firstRow, ...data.connectionCounts.slice(1)]
    };
    expect(() => makeSet(tampered)).toThrowError(
      `Ordered ENAData connectionCounts row 0 is missing directed column "${missingColumn}".`
    );
  });

  it("rejects disagreement between ordered count rows and the numeric matrix", () => {
    const data = orderedData();
    const column = data.codeColumns[0]!;
    const tampered: ENAData = {
      ...data,
      connectionCounts: [
        { ...data.connectionCounts[0]!, [column]: Number(data.connectionCounts[0]?.[column] ?? 0) + 1 },
        ...data.connectionCounts.slice(1)
      ]
    };
    expect(() => makeSet(tampered)).toThrowError(
      `Ordered ENAData connectionCounts[0]["${column}"] does not match connectionMatrix[0][0].`
    );
  });

  it("rejects explicitly standard data carrying an ordered square schema", () => {
    const data = orderedData();
    const tampered: ENAData = {
      ...data,
      networkType: "standard",
      functionParams: { ...data.functionParams, networkType: "standard" }
    };
    expect(() => makeSet(tampered)).toThrowError(
      'Explicit standard ENAData codeColumns must contain 1 upper-triangle headers for 2 codes; got 4. ' +
      'Omit networkType only for legacy externally constructed directed data.'
    );
  });

  it("accepts an explicitly standard upper-triangle schema", () => {
    const standard = accumulateData({
      rows,
      units: ["unit"],
      conversation: ["horizon"],
      codes: ["A", "B"],
      networkType: "standard",
      windowSizeBack: 2
    });
    const explicitStandard: ENAData = {
      ...standard,
      networkType: "standard",
      functionParams: { ...standard.functionParams, networkType: "standard" }
    };
    expect(() => makeSet(explicitStandard)).not.toThrow();
  });

  it("projectIn inherits the same runtime data validation", () => {
    const data = orderedData();
    const set = makeSet(data);
    const tampered = { ...data, networkType: "mystery" as never };
    expect(() => projectIn(tampered, set)).toThrowError(
      'ENAData networkType must be one of standard, ordered; got "mystery".'
    );
  });

  it("preserves legacy externally built square directed data when networkType is absent", () => {
    const data = orderedData();
    const { networkType: _dataNetworkType, ...withoutDataNetworkType } = data;
    const { networkType: _paramsNetworkType, ...legacyFunctionParams } = data.functionParams;
    const legacyDirected: ENAData = {
      ...withoutDataNetworkType,
      functionParams: legacyFunctionParams
    };

    const set = makeSet(legacyDirected, { nodePositionMethod: "directed" });
    expect(set.rotation.nodes).toHaveLength(2);
    expect(set.codeColumns).toHaveLength(4);
  });
});
