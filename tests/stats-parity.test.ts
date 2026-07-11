import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cohensD, ena, enaCorrelations, enaStats, inverseNormal } from "../src/index.js";
import type { ENASet, Row } from "../src/index.js";

const configsPath = new URL("../fixtures/goldens/sena-configs.generated.json", import.meta.url);
const statsPath = new URL("../fixtures/goldens/stats.generated.json", import.meta.url);

type StatsGolden = {
  meta: { rENAVersion?: string };
  qnorm: { p: number[]; value: number[] };
  toy: DatasetStats;
  research: DatasetStats;
};

type DatasetStats = {
  correlations: {
    dimensions: string[];
    pearson: number[];
    spearman: number[];
    pearsonLower: number[];
    pearsonUpper: number[];
    pairCount: number;
  };
  cohensD: { groupColumn: string; groups: string[]; SVD1: number; SVD2: number };
  welch: { groupColumn: string; groups: string[]; dimension: string; statistic: number; df: number };
  anova?: { groupColumn: string; dimension: string; statistic: number; dfBetween: number; dfWithin: number };
};

if (!existsSync(configsPath) || !existsSync(statsPath)) {
  describe.skip("stats parity with rENA", () => {
    it("requires golden fixtures from npm run goldens:r / goldens:stats", () => undefined);
  });
} else {
  const configs = JSON.parse(readFileSync(configsPath, "utf8"));
  const stats = JSON.parse(readFileSync(statsPath, "utf8")) as StatsGolden;

  function groupedDimension(set: ENASet, column: string, group: string, dimension: string): number[] {
    return set.points
      .filter((row) => String(row[column]) === group)
      .map((row) => Number(row[dimension] ?? 0));
  }

  function expectDatasetStats(set: ENASet, golden: DatasetStats) {
    const correlations = enaCorrelations(set);
    expect(correlations.map((entry) => entry.dimension)).toEqual(golden.correlations.dimensions);
    correlations.forEach((entry, index) => {
      expect(entry.pearson).toBeCloseTo(golden.correlations.pearson[index] ?? Number.NaN, 9);
      expect(entry.spearman).toBeCloseTo(golden.correlations.spearman[index] ?? Number.NaN, 9);
      expect(entry.pearsonLower).toBeCloseTo(golden.correlations.pearsonLower[index] ?? Number.NaN, 8);
      expect(entry.pearsonUpper).toBeCloseTo(golden.correlations.pearsonUpper[index] ?? Number.NaN, 8);
    });

    const [leftGroup, rightGroup] = golden.cohensD.groups;
    for (const dimension of ["SVD1", "SVD2"] as const) {
      const left = groupedDimension(set, golden.cohensD.groupColumn, leftGroup ?? "", dimension);
      const right = groupedDimension(set, golden.cohensD.groupColumn, rightGroup ?? "", dimension);
      expect(cohensD(left, right)).toBeCloseTo(golden.cohensD[dimension], 9);
    }

    const grouped = enaStats(set, { by: golden.welch.groupColumn });
    const welch = (grouped.tests ?? []).find((test) => test.dimension === golden.welch.dimension && test.test === "welch-t");
    expect(welch).toBeTruthy();
    expect(welch?.groups).toEqual(golden.welch.groups);
    // Dimension signs are arbitrary (SVD sign indeterminacy), so the t
    // statistic is compared in magnitude against R's t.test, and its sign is
    // checked against the group mean difference in jena's own orientation.
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const leftValues = groupedDimension(set, golden.welch.groupColumn, golden.welch.groups[0] ?? "", golden.welch.dimension);
    const rightValues = groupedDimension(set, golden.welch.groupColumn, golden.welch.groups[1] ?? "", golden.welch.dimension);
    expect(Math.abs(welch?.statistic ?? Number.NaN)).toBeCloseTo(Math.abs(golden.welch.statistic), 9);
    expect(Math.sign(welch?.statistic ?? 0)).toBe(Math.sign(mean(leftValues) - mean(rightValues)));
    expect(welch?.df).toBeCloseTo(golden.welch.df, 9);

    if (golden.anova) {
      const byRole = enaStats(set, { by: golden.anova.groupColumn });
      const anova = (byRole.tests ?? []).find((test) => test.dimension === golden.anova?.dimension && test.test === "one-way-anova");
      expect(anova).toBeTruthy();
      expect(anova?.statistic).toBeCloseTo(golden.anova.statistic, 9);
      expect(anova?.dfBetween).toBe(golden.anova.dfBetween);
      expect(anova?.dfWithin).toBe(golden.anova.dfWithin);
    }
  }

  describe("stats parity with rENA", () => {
    it("matches R qnorm quantiles (inverseNormal, |err| < 1e-8)", () => {
      stats.qnorm.p.forEach((p, index) => {
        const expected = stats.qnorm.value[index] ?? Number.NaN;
        expect(Math.abs(inverseNormal(p) - expected)).toBeLessThan(1e-8 * Math.max(1, Math.abs(expected)));
      });
    });

    it("matches rENA ena.correlations, fun_cohens.d, and R tests on the toy dataset", () => {
      const set = ena({
        rows: configs.input as Row[],
        units: ["unit"],
        conversation: ["conv"],
        codes: configs.codes as string[],
        metadata: ["group"],
        ...configs.configs.movingBinary.options
      });
      expectDatasetStats(set, stats.toy);
    });

    it("matches rENA ena.correlations, fun_cohens.d, and R tests on the research dataset", () => {
      const set = ena({
        rows: configs.research.input as Row[],
        units: ["person"],
        conversation: ["team", "stanza"],
        codes: configs.research.codes as string[],
        metadata: ["group", "role"],
        ...configs.research.configs.personMovingBinary.options
      });
      expectDatasetStats(set, stats.research);
    });
  });
}
