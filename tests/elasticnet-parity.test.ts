import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ena } from "../src/index.js";
import { multiGaussianElasticNet, multiGaussianElasticNetCV } from "../src/experimental.js";
import type { Matrix, Row } from "../src/index.js";

// The multivariate elastic net is verified against glmnet (family =
// "mgaussian") at FIXED lambda values — the deterministic core of rENA's
// multi-covariate generalized rotation. Lambda SELECTION itself (cv.glmnet)
// randomizes folds in rENA and cannot be golden-tested; jena's CV is
// deterministic instead (property-tested below).
const fixturePath = new URL("../fixtures/goldens/elasticnet.generated.json", import.meta.url);
const configsPath = new URL("../fixtures/goldens/sena-configs.generated.json", import.meta.url);

type ElasticNetCase = {
  alpha: number;
  penaltyFactor: number[];
  standardize: boolean;
  lambdas: number[];
  intercepts: number[][];
  coefficients: Array<Record<string, number[]>>;
};

type ElasticNetFixture = {
  meta: { glmnetVersion?: string; rVersion?: string };
  x: Matrix;
  y: Matrix;
  cases: Record<string, ElasticNetCase>;
};

if (!existsSync(fixturePath)) {
  describe.skip("elastic net parity with glmnet", () => {
    it("requires fixtures/goldens/elasticnet.generated.json from npm run goldens:elasticnet", () => undefined);
  });
} else {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as ElasticNetFixture;

  describe("elastic net parity with glmnet (fixed lambda)", () => {
    it("fixture carries its generation provenance", () => {
      expect(fixture.meta.glmnetVersion).toBeTruthy();
    });

    // glmnet's thresh is a scaled-deviance criterion, so its coefficient
    // precision degrades toward small lambdas (observed up to ~2.5e-7 at
    // lambda=0.004 even with thresh=1e-14); jena iterates to a 1e-12
    // coefficient-change tolerance, so the comparison bound reflects
    // glmnet's precision, not jena's.
    const GLMNET_ATOL = 1e-6;
    const expectGlmnetClose = (actual: number, expected: number, label: string) => {
      expect(Math.abs(actual - expected), `${label}: |${actual} - ${expected}|`).toBeLessThan(GLMNET_ATOL);
    };

    for (const [caseName, testCase] of Object.entries(fixture.cases)) {
      it(`matches glmnet mgaussian coefficients for ${caseName}`, () => {
        testCase.lambdas.forEach((lambda, lambdaIndex) => {
          const fit = multiGaussianElasticNet(fixture.x, fixture.y, {
            lambda,
            alpha: testCase.alpha,
            penaltyFactor: testCase.penaltyFactor,
            standardize: testCase.standardize
          });
          const goldenIntercepts = testCase.intercepts[lambdaIndex] ?? [];
          goldenIntercepts.forEach((intercept, k) => {
            expectGlmnetClose(fit.intercepts[k] ?? Number.NaN, intercept, `${caseName} lambda=${lambda} intercept ${k}`);
          });
          const goldenByResponse = Object.values(testCase.coefficients[lambdaIndex] ?? {});
          goldenByResponse.forEach((column, k) => {
            column.forEach((value, predictor) => {
              expectGlmnetClose(fit.coefficients[predictor]?.[k] ?? Number.NaN, value, `${caseName} lambda=${lambda} beta[${predictor}][${k}]`);
            });
          });
        });
      });
    }

    it("keeps unpenalized predictors in the model at every lambda", () => {
      const gmrShape = fixture.cases.gmrShape;
      expect(gmrShape).toBeTruthy();
      for (const lambda of gmrShape?.lambdas ?? []) {
        const fit = multiGaussianElasticNet(fixture.x, fixture.y, {
          lambda,
          alpha: 1,
          penaltyFactor: gmrShape?.penaltyFactor ?? []
        });
        const norm = Math.hypot(...(fit.coefficients[0] ?? []));
        expect(norm, `lambda=${lambda}`).toBeGreaterThan(0);
      }
    });

    it("selects lambda deterministically in CV (repeat runs identical)", () => {
      const first = multiGaussianElasticNetCV(fixture.x, fixture.y, { alpha: 1, penaltyFactor: [0, 1, 1, 1] });
      const second = multiGaussianElasticNetCV(fixture.x, fixture.y, { alpha: 1, penaltyFactor: [0, 1, 1, 1] });
      expect(first.lambda).toBe(second.lambda);
      expect(first.coefficients).toEqual(second.coefficients);
      expect(first.lambdas.length).toBeGreaterThan(10);
      // The path is strictly decreasing like glmnet's.
      for (let index = 1; index < first.lambdas.length; index += 1) {
        expect(first.lambdas[index]!).toBeLessThan(first.lambdas[index - 1]!);
      }
    });
  });

  describe("multi-covariate generalized rotation (deterministic elastic-net path)", () => {
    const configs = JSON.parse(readFileSync(configsPath, "utf8"));

    it("is deterministic and structurally sound on the research dataset", () => {
      const options = {
        rows: configs.research.input as Row[],
        units: ["person"],
        conversation: ["team", "stanza"],
        codes: configs.research.codes as string[],
        metadata: ["group", "role"],
        windowSizeBack: 2,
        rotation: { method: "generalized" as const, params: { xVar: ["group", "role"] } }
      };
      const first = ena(options);
      const second = ena(options);
      expect(first.points).toEqual(second.points);
      expect(first.rotation.rotationMatrix).toEqual(second.rotation.rotationMatrix);
      expect(first.rotation.rotationColumns[0]).toBe("RR1");
      const total = Object.values(first.variance).reduce((sum, value) => sum + value, 0);
      expect(total).toBeCloseTo(1, 9);
    });
  });
}
