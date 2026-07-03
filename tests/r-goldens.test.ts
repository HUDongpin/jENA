import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accumulateData, ena, refWindowMatrix, rowsToCoOccurrences, sphereNorm } from "../src/index.js";
import type { Matrix, Row } from "../src/index.js";

const fixturePath = new URL("../fixtures/goldens/sena-configs.generated.json", import.meta.url);

type GoldenConfig = {
  options: {
    model: "EndPoint" | "AccumulatedTrajectory" | "SeparateTrajectory";
    weightBy: "binary" | "sum";
    window: "MovingStanzaWindow" | "Conversation";
    windowSizeBack: number;
    windowSizeForward: number;
    dimensions: number;
    rotation?: {
      method: "mean";
      params: { groups: Array<[string[], string[]]> };
    };
  };
  rowConnectionCounts: Row[];
  connectionCounts: Row[];
  unitLabels: string[];
  trajectories?: Row[];
  lineWeights: Row[];
  points: Row[];
  nodes: Row[];
  rotationMatrix: Row[];
  variance: number[];
};

type GoldenDataset = {
  input: Row[];
  codes: string[];
  configs: Record<string, GoldenConfig>;
};

type GoldenFixture = GoldenDataset & {
  lowLevel: {
    rowsToCoOccurrencesBinary: Matrix;
    rowsToCoOccurrencesWeighted: Matrix;
    refWindowBack2: Matrix;
    refWindowBack2Forward1: Matrix;
    refWindowBackInf: Matrix;
    sphereNorm: Matrix;
  };
  research?: GoldenDataset;
};

type DatasetSpec = {
  dataset: GoldenDataset;
  name: string;
  units: string[];
  conversation: string[];
  metadata: string[];
  trajectoryColumns: string[];
  endpointConfigName: string;
  pointIdColumn: string;
  meanRotationConfigName: string;
};

function codeColumns(codes: string[]) {
  const columns: string[] = [];
  for (let target = 1; target < codes.length; target += 1) {
    for (let source = 0; source < target; source += 1) {
      columns.push(`${codes[source]} & ${codes[target]}`);
    }
  }
  return columns;
}

function matrixFromRows(rows: Row[], columns: string[]): Matrix {
  return rows.map((row) => columns.map((column) => Number(row[column] ?? 0)));
}

function expectMatrixClose(actual: Matrix, expected: Matrix, precision = 12) {
  expect(actual.length).toBe(expected.length);
  for (let row = 0; row < expected.length; row += 1) {
    expect(actual[row]?.length).toBe(expected[row]?.length);
    for (let column = 0; column < (expected[row]?.length ?? 0); column += 1) {
      expect(actual[row]?.[column] ?? 0).toBeCloseTo(expected[row]?.[column] ?? 0, precision);
    }
  }
}

function signForRows(expected: Row[], actual: Row[], column: string, idColumn: string) {
  const actualById = new Map(actual.map((row) => [String(row[idColumn]), row]));
  const dot = expected.reduce((total, expectedRow) => {
    const actualRow = actualById.get(String(expectedRow[idColumn]));
    return total + Number(expectedRow[column] ?? 0) * Number(actualRow?.[column] ?? 0);
  }, 0);
  return dot < 0 ? -1 : 1;
}

function expectProjectedRowsClose(actual: Row[], expected: Row[], idColumn: string, columns: string[], precision = 6) {
  expect(actual.length).toBe(expected.length);
  const actualById = new Map(actual.map((row) => [String(row[idColumn]), row]));
  const signs = Object.fromEntries(columns.map((column) => [column, signForRows(expected, actual, column, idColumn)]));
  for (const expectedRow of expected) {
    const actualRow = actualById.get(String(expectedRow[idColumn]));
    expect(actualRow).toBeTruthy();
    for (const column of columns) {
      expect(Number(actualRow?.[column] ?? 0) * Number(signs[column])).toBeCloseTo(Number(expectedRow[column] ?? 0), precision);
    }
  }
}

function expectStringColumns(actual: Row[], expected: Row[], columns: string[]) {
  expect(actual.length).toBe(expected.length);
  for (let row = 0; row < expected.length; row += 1) {
    for (const column of columns) {
      expect(String(actual[row]?.[column] ?? "")).toBe(String(expected[row]?.[column] ?? ""));
    }
  }
}

if (!existsSync(fixturePath)) {
  describe.skip("R golden parity", () => {
    it("requires fixtures/goldens/sena-configs.generated.json from npm run goldens:r", () => undefined);
  });
} else {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as GoldenFixture;
  const codeMatrix = matrixFromRows(fixture.input, fixture.codes);

  function expectDatasetParity(spec: DatasetSpec) {
    const datasetColumns = codeColumns(spec.dataset.codes);

    for (const [name, config] of Object.entries(spec.dataset.configs)) {
      it(`matches rENA accumulation and line weights for ${spec.name} ${name}`, () => {
        const data = accumulateData({
          rows: spec.dataset.input,
          units: spec.units,
          conversation: spec.conversation,
          codes: spec.dataset.codes,
          metadata: spec.metadata,
          model: config.options.model,
          weightBy: config.options.weightBy,
          window: config.options.window,
          windowSizeBack: config.options.windowSizeBack,
          windowSizeForward: config.options.windowSizeForward
        });
        const set = ena({
          rows: spec.dataset.input,
          units: spec.units,
          conversation: spec.conversation,
          codes: spec.dataset.codes,
          metadata: spec.metadata,
          ...config.options
        });

        expect(data.unitLabels).toEqual(config.unitLabels);
        expectMatrixClose(matrixFromRows(data.rowConnectionCounts, datasetColumns), matrixFromRows(config.rowConnectionCounts, datasetColumns), 12);
        expectMatrixClose(matrixFromRows(data.connectionCounts, datasetColumns), matrixFromRows(config.connectionCounts, datasetColumns), 12);
        expectMatrixClose(matrixFromRows(set.lineWeights, datasetColumns), matrixFromRows(config.lineWeights, datasetColumns), 12);

        if (config.trajectories) {
          expectStringColumns(data.trajectories ?? [], config.trajectories, spec.trajectoryColumns);
        }
      });
    }

    it(`matches rENA SVD projections and undirected node placement for ${spec.name}`, () => {
      const config = spec.dataset.configs[spec.endpointConfigName];
      expect(config).toBeTruthy();
      if (!config) return;
      const set = ena({
        rows: spec.dataset.input,
        units: spec.units,
        conversation: spec.conversation,
        codes: spec.dataset.codes,
        metadata: spec.metadata,
        ...config.options
      });
      expectProjectedRowsClose(set.points, config.points, spec.pointIdColumn, ["SVD1", "SVD2"], 6);
      expectProjectedRowsClose(set.rotation.nodes ?? [], config.nodes, "code", ["SVD1", "SVD2"], 6);
    });

    it(`matches rENA means rotation for ${spec.name}`, () => {
      const config = spec.dataset.configs[spec.meanRotationConfigName];
      expect(config).toBeTruthy();
      if (!config) return;
      const set = ena({
        rows: spec.dataset.input,
        units: spec.units,
        conversation: spec.conversation,
        codes: spec.dataset.codes,
        metadata: spec.metadata,
        ...config.options
      });
      expect(set.rotation.rotationColumns).toEqual(["MR1", "SVD2"]);
      expectProjectedRowsClose(set.points, config.points, spec.pointIdColumn, ["MR1", "SVD2"], 6);
      expectProjectedRowsClose(set.rotation.nodes ?? [], config.nodes, "code", ["MR1", "SVD2"], 6);
    });
  }

  describe("R golden parity", () => {
    it("matches low-level rENA co-occurrence and window fixtures", () => {
      expect(rowsToCoOccurrences(codeMatrix, true)).toEqual(fixture.lowLevel.rowsToCoOccurrencesBinary);
      expect(rowsToCoOccurrences(codeMatrix, false)).toEqual(fixture.lowLevel.rowsToCoOccurrencesWeighted);
      expect(refWindowMatrix(codeMatrix, 2, 0, true)).toEqual(fixture.lowLevel.refWindowBack2);
      expect(refWindowMatrix(codeMatrix, 2, 1, true)).toEqual(fixture.lowLevel.refWindowBack2Forward1);
      expect(refWindowMatrix(codeMatrix, Number.POSITIVE_INFINITY, 0, true)).toEqual(fixture.lowLevel.refWindowBackInf);
      expect(sphereNorm([[3, 4], [0, 0]])).toEqual(fixture.lowLevel.sphereNorm);
    });

    expectDatasetParity({
      dataset: fixture,
      name: "toy",
      units: ["unit"],
      conversation: ["conv"],
      metadata: ["group"],
      trajectoryColumns: ["unit", "conv"],
      endpointConfigName: "movingBinary",
      pointIdColumn: "unit",
      meanRotationConfigName: "meanRotation"
    });

    describe("research-shaped fixture", () => {
      it("is present in the generated rENA goldens", () => {
        expect(fixture.research).toBeTruthy();
      });

      if (fixture.research) {
        expectDatasetParity({
          dataset: fixture.research,
          name: "research",
          units: ["person"],
          conversation: ["team", "stanza"],
          metadata: ["group", "role"],
          trajectoryColumns: ["person", "team", "stanza"],
          endpointConfigName: "personMovingBinary",
          pointIdColumn: "person",
          meanRotationConfigName: "personMeanRotation"
        });
      }
    });
  });
}
