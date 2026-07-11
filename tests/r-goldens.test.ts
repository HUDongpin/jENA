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
  meta?: {
    generatedAt?: string;
    rVersion?: string;
    platform?: string;
    rENAVersion?: string;
    tmaVersion?: string;
    generatorScript?: string;
  };
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
};

// Shares below this threshold correspond to numerically null directions where
// eigenvector orientation is arbitrary, so those columns are not comparable.
const NEGLIGIBLE_VARIANCE_SHARE = 1e-9;

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

// rENA dimension signs are arbitrary (SVD sign indeterminacy), so columns are
// compared up to a per-column sign chosen by the dot product with the golden.
function columnSign(actual: number[], expected: number[]): number {
  const dot = expected.reduce((total, value, index) => total + value * (actual[index] ?? 0), 0);
  return dot < 0 ? -1 : 1;
}

type Tolerance = { atol: number; rtol: number };

const POINT_TOLERANCE: Tolerance = { atol: 5e-7, rtol: 0 };
// Node positions solve least-squares systems that are singular on these small
// fixtures (rENA's own solver warns "system is singular; attempting approx
// solution" here). jena's documented 1e-10 ridge and Armadillo's approximate
// solve both approach the same minimum-norm solution, but only to a few 1e-6
// — see NUMERICS.md. Semantic regressions move nodes by orders of magnitude
// more than this bound.
const NODE_TOLERANCE: Tolerance = { atol: 4e-6, rtol: 2e-6 };

function expectProjectedRowsClose(actual: Row[], expected: Row[], columns: string[], tolerance: Tolerance) {
  expect(actual.length).toBe(expected.length);
  for (const column of columns) {
    const actualValues = actual.map((row) => Number(row[column] ?? 0));
    const expectedValues = expected.map((row) => Number(row[column] ?? 0));
    const sign = columnSign(actualValues, expectedValues);
    for (let row = 0; row < expectedValues.length; row += 1) {
      const expectedValue = expectedValues[row] ?? 0;
      const difference = Math.abs((actualValues[row] ?? 0) * sign - expectedValue);
      const bound = tolerance.atol + tolerance.rtol * Math.abs(expectedValue);
      expect(difference, `${column} row ${row}: |${(actualValues[row] ?? 0) * sign} - ${expectedValue}|`).toBeLessThanOrEqual(bound);
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

function fixtureRotationColumns(config: GoldenConfig): string[] {
  const first = config.rotationMatrix[0] ?? {};
  return Object.keys(first).filter((key) => key !== "codes");
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

        expect(data.unitLabels).toEqual(config.unitLabels);
        expectMatrixClose(matrixFromRows(data.rowConnectionCounts, datasetColumns), matrixFromRows(config.rowConnectionCounts, datasetColumns), 12);
        expectMatrixClose(matrixFromRows(data.connectionCounts, datasetColumns), matrixFromRows(config.connectionCounts, datasetColumns), 12);

        if (config.trajectories) {
          expectStringColumns(data.trajectories ?? [], config.trajectories, spec.trajectoryColumns);
        }
      });

      it(`matches rENA projection, nodes, variance, and rotation for ${spec.name} ${name}`, () => {
        const set = ena({
          rows: spec.dataset.input,
          units: spec.units,
          conversation: spec.conversation,
          codes: spec.dataset.codes,
          metadata: spec.metadata,
          ...config.options
        });

        expectMatrixClose(matrixFromRows(set.lineWeights, datasetColumns), matrixFromRows(config.lineWeights, datasetColumns), 12);

        // rENA's rotation columns (rank-retained) must be a prefix of ours.
        const goldenColumns = fixtureRotationColumns(config);
        expect(set.rotation.rotationColumns.slice(0, goldenColumns.length)).toEqual(goldenColumns);

        // Projected points and node positions for the displayed dimensions.
        const displayColumns = goldenColumns.slice(0, config.options.dimensions);
        expectProjectedRowsClose(set.points, config.points, displayColumns, POINT_TOLERANCE);
        const nodes = set.rotation.nodes ?? [];
        expectStringColumns(nodes, config.nodes, ["code"]);
        expectProjectedRowsClose(nodes, config.nodes, displayColumns, NODE_TOLERANCE);

        // Variance explained is normalized over ALL rotated dimensions (F-001).
        const shares = set.rotation.rotationColumns.map((column) => set.variance[column] ?? 0);
        expect(shares.length).toBeGreaterThanOrEqual(config.variance.length);
        for (let index = 0; index < config.variance.length; index += 1) {
          expect(shares[index] ?? 0).toBeCloseTo(config.variance[index] ?? 0, 9);
        }
        for (let index = config.variance.length; index < shares.length; index += 1) {
          expect(Math.abs(shares[index] ?? 0)).toBeLessThan(NEGLIGIBLE_VARIANCE_SHARE);
        }

        // Full rotation matrix, column-by-column up to sign, for every
        // direction that carries non-negligible variance.
        const jenaRotationRows = new Map<string, number[]>();
        set.rotation.rotationMatrix.forEach((row, index) => {
          jenaRotationRows.set(datasetColumns[index] ?? String(index), row);
        });
        for (let columnIndex = 0; columnIndex < goldenColumns.length; columnIndex += 1) {
          if ((config.variance[columnIndex] ?? 0) < NEGLIGIBLE_VARIANCE_SHARE) continue;
          const columnName = goldenColumns[columnIndex] ?? "";
          const expectedColumn = config.rotationMatrix.map((row) => Number(row[columnName] ?? 0));
          const actualColumn = config.rotationMatrix.map((row) => {
            const jenaRow = jenaRotationRows.get(String(row.codes ?? ""));
            expect(jenaRow, `rotation row for ${String(row.codes)}`).toBeTruthy();
            return jenaRow?.[columnIndex] ?? 0;
          });
          const sign = columnSign(actualColumn, expectedColumn);
          for (let row = 0; row < expectedColumn.length; row += 1) {
            expect((actualColumn[row] ?? 0) * sign).toBeCloseTo(expectedColumn[row] ?? 0, 6);
          }
        }
      });
    }
  }

  describe("R golden parity", () => {
    it("fixture carries its generation provenance (rENA/tma/R versions)", () => {
      expect(fixture.meta?.rENAVersion).toBeTruthy();
      expect(fixture.meta?.rVersion).toMatch(/^R version/);
      expect(fixture.meta?.generatedAt).toBeTruthy();
      expect(fixture.meta?.generatorScript).toBeTruthy();
    });

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
      trajectoryColumns: ["unit", "conv"]
    });

    describe("research-shaped fixture", () => {
      it("is present in the generated rENA goldens", () => {
        expect(fixture.research).toBeTruthy();
        expect(Object.keys(fixture.research?.configs ?? {})).toContain("personSeparateTrajectory");
      });

      if (fixture.research) {
        expectDatasetParity({
          dataset: fixture.research,
          name: "research",
          units: ["person"],
          conversation: ["team", "stanza"],
          metadata: ["group", "role"],
          trajectoryColumns: ["person", "team", "stanza"]
        });
      }
    });
  });
}
