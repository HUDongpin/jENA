import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accumulateData, ena, refWindowMatrix, rowsToCoOccurrences, sphereNorm } from "../src/index.js";
import type { Matrix, Row } from "../src/index.js";
import {
  codeColumns,
  expectMatrixClose,
  expectProjectionParity,
  expectStringColumns,
  matrixFromRows
} from "./golden-helpers.js";

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
        expectProjectionParity(set, config, datasetColumns, config.options.dimensions);
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
