import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ena } from "../src/index.js";
import type { RotationOptions, Row } from "../src/index.js";
import { codeColumns, expectProjectionParity } from "./golden-helpers.js";

// Parity for the regression / regression2 / generalized rotations against
// goldens generated from rENA 0.3.1 (advisory F-002). Only deterministic
// paths are covered: multi-covariate generalized rotations run through
// cv.glmnet (randomized folds) in rENA and cannot be golden-tested.
const configsPath = new URL("../fixtures/goldens/sena-configs.generated.json", import.meta.url);
const rotationsPath = new URL("../fixtures/goldens/rotations.generated.json", import.meta.url);

type RotationGoldenConfig = {
  options: {
    model: "EndPoint";
    weightBy: "binary";
    window: "MovingStanzaWindow";
    windowSizeBack: number;
    windowSizeForward: number;
    dimensions: number;
    rotation: RotationOptions;
  };
  unitLabels: string[];
  points: Row[];
  nodes: Row[];
  rotationMatrix: Row[];
  rotationColumnNames: string[];
  variance: number[];
};

type RotationFixture = {
  meta?: { rENAVersion?: string; rVersion?: string; generatedAt?: string; generatorScript?: string };
  toy: { configs: Record<string, RotationGoldenConfig> };
  research: { configs: Record<string, RotationGoldenConfig> };
  regression2: {
    input: Row[];
    codes: string[];
    units: string;
    conversation: string;
    metadata: string[];
    configs: Record<string, RotationGoldenConfig>;
  };
};

if (!existsSync(configsPath) || !existsSync(rotationsPath)) {
  describe.skip("rotation parity with rENA", () => {
    it("requires golden fixtures from npm run goldens:r / goldens:rotations", () => undefined);
  });
} else {
  const mainFixture = JSON.parse(readFileSync(configsPath, "utf8"));
  const fixture = JSON.parse(readFileSync(rotationsPath, "utf8")) as RotationFixture;

  type Spec = {
    name: string;
    input: Row[];
    codes: string[];
    units: string[];
    conversation: string[];
    metadata: string[];
    configs: Record<string, RotationGoldenConfig>;
  };

  const specs: Spec[] = [
    {
      name: "toy",
      input: mainFixture.input as Row[],
      codes: mainFixture.codes as string[],
      units: ["unit"],
      conversation: ["conv"],
      metadata: ["group"],
      configs: fixture.toy.configs
    },
    {
      name: "research",
      input: mainFixture.research.input as Row[],
      codes: mainFixture.research.codes as string[],
      units: ["person"],
      conversation: ["team", "stanza"],
      metadata: ["group", "role"],
      configs: fixture.research.configs
    },
    {
      name: "regression2",
      input: fixture.regression2.input,
      codes: fixture.regression2.codes,
      units: ["unit"],
      conversation: ["conv"],
      metadata: fixture.regression2.metadata,
      configs: fixture.regression2.configs
    }
  ];

  describe("rotation parity with rENA", () => {
    it("fixture carries its generation provenance", () => {
      expect(fixture.meta?.rENAVersion).toBeTruthy();
      expect(fixture.meta?.rVersion).toMatch(/^R version/);
    });

    for (const spec of specs) {
      for (const [configName, config] of Object.entries(spec.configs)) {
        it(`matches rENA ${config.options.rotation.method} rotation for ${spec.name} ${configName}`, () => {
          const set = ena({
            rows: spec.input,
            units: spec.units,
            conversation: spec.conversation,
            codes: spec.codes,
            metadata: spec.metadata,
            ...config.options
          });
          expect(set.unitLabels).toEqual(config.unitLabels);
          expectProjectionParity(set, config, codeColumns(spec.codes), config.options.dimensions);
        });
      }
    }
  });
}
