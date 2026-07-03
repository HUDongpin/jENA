import type { ENASet, Row, Scalar } from './types.js';
import { cohensD as coreCohensD, pearsonCorrelation } from './core/matrix.js';

export interface DimensionCorrelation {
  dimension: string;
  pearson: number;
  spearman: number;
  pearsonLower: number;
  pearsonUpper: number;
}

export interface GroupSummaryRow {
  group: string;
  n: number;
  means: Record<string, number>;
}

export interface DimensionSummaryRow {
  dimension: string;
  n: number;
  mean: number;
  sd: number;
  variance: number;
  min: number;
  max: number;
}

export interface StatTestRow {
  dimension: string;
  test: 'welch-t' | 'one-way-anova';
  groups: string[];
  statistic: number;
  df?: number;
  dfBetween?: number;
  dfWithin?: number;
}

export interface ENAStatsOptions {
  dims?: Array<number | string>;
  by?: string;
  confLevel?: number;
}

export interface ENAStatsResult {
  dimensions: DimensionSummaryRow[];
  correlations: DimensionCorrelation[];
  groups?: GroupSummaryRow[];
  tests?: StatTestRow[];
}

function dimensionNames(set: ENASet, dims?: Array<number | string>): string[] {
  if (!dims) return set.rotation.rotationColumns.slice(0, 2);
  return dims.map((dim) => (typeof dim === 'number'
    ? set.rotation.rotationColumns[dim - 1] ?? `Dimension${dim}`
    : dim));
}

function values(rows: Row[], column: string): number[] {
  return rows.map((row) => {
    const value = Number(row[column] ?? 0);
    return Number.isFinite(value) ? value : 0;
  });
}

function ranks(input: number[]): number[] {
  const sorted = input.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const out = Array.from({ length: input.length }, () => 0);
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor + 1;
    while (end < sorted.length && sorted[end]?.value === sorted[cursor]?.value) end += 1;
    const rank = (cursor + 1 + end) / 2;
    for (let i = cursor; i < end; i += 1) {
      const index = sorted[i]?.index ?? 0;
      out[index] = rank;
    }
    cursor = end;
  }
  return out;
}

function inverseNormal(p: number): number {
  if (p <= 0 || p >= 1) return Number.NaN;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const plow = 0.02425;
  const phigh = 1 - plow;
  const horner = (coefficients: number[], x: number) => coefficients.reduce((total, coefficient) => total * x + coefficient, 0);
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    const numerator = horner(c, q);
    const denominator = horner(d, q) * q + 1;
    return numerator / denominator;
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    const numerator = horner(c, q);
    const denominator = horner(d, q) * q + 1;
    return -numerator / denominator;
  }
  const q = p - 0.5;
  const r = q * q;
  const numerator = horner(a, r) * q;
  const denominator = horner(b, r) * r + 1;
  return numerator / denominator;
}

function confidenceInterval(r: number, n: number, confLevel: number): [number, number] {
  if (!Number.isFinite(r) || n <= 3) return [Number.NaN, Number.NaN];
  const z = Math.atanh(Math.max(-0.999999999999, Math.min(0.999999999999, r)));
  const sigma = 1 / Math.sqrt(n - 3);
  const q = inverseNormal((1 + confLevel) / 2);
  return [Math.tanh(z - sigma * q), Math.tanh(z + sigma * q)];
}

function finiteValues(rows: Row[], column: string): number[] {
  return values(rows, column).filter(Number.isFinite);
}

function mean(input: number[]): number {
  return input.length === 0 ? Number.NaN : input.reduce((sum, value) => sum + value, 0) / input.length;
}

function sampleVariance(input: number[]): number {
  if (input.length < 2) return Number.NaN;
  const avg = mean(input);
  return input.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (input.length - 1);
}

function groupedPointValues(set: ENASet, by: string, dimension: string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of set.points) {
    const key = String((row[by] ?? null) as Scalar);
    const current = groups.get(key) ?? [];
    current.push(Number(row[dimension] ?? 0));
    groups.set(key, current);
  }
  return groups;
}

function welchTTest(dimension: string, groups: Array<[string, number[]]>): StatTestRow | undefined {
  const [left, right] = groups;
  if (!left || !right || groups.length !== 2) return undefined;
  const leftMean = mean(left[1]);
  const rightMean = mean(right[1]);
  const leftVariance = sampleVariance(left[1]);
  const rightVariance = sampleVariance(right[1]);
  const leftTerm = leftVariance / left[1].length;
  const rightTerm = rightVariance / right[1].length;
  const denominator = Math.sqrt(leftTerm + rightTerm);
  const statistic = denominator === 0 ? Number.NaN : (leftMean - rightMean) / denominator;
  const dfNumerator = Math.pow(leftTerm + rightTerm, 2);
  const dfDenominator = Math.pow(leftTerm, 2) / (left[1].length - 1) + Math.pow(rightTerm, 2) / (right[1].length - 1);
  return {
    dimension,
    test: 'welch-t',
    groups: [left[0], right[0]],
    statistic,
    df: dfDenominator === 0 ? Number.NaN : dfNumerator / dfDenominator
  };
}

function oneWayAnova(dimension: string, groups: Array<[string, number[]]>): StatTestRow | undefined {
  const populated = groups.filter((entry) => entry[1].length > 0);
  if (populated.length < 2) return undefined;
  const all = populated.flatMap((entry) => entry[1]);
  const overallMean = mean(all);
  const between = populated.reduce((sum, entry) => sum + entry[1].length * Math.pow(mean(entry[1]) - overallMean, 2), 0);
  const within = populated.reduce((sum, entry) => {
    const groupMean = mean(entry[1]);
    return sum + entry[1].reduce((inner, value) => inner + Math.pow(value - groupMean, 2), 0);
  }, 0);
  const dfBetween = populated.length - 1;
  const dfWithin = all.length - populated.length;
  const statistic = dfWithin <= 0 || within === 0 ? Number.NaN : (between / dfBetween) / (within / dfWithin);
  return {
    dimension,
    test: 'one-way-anova',
    groups: populated.map((entry) => entry[0]),
    statistic,
    dfBetween,
    dfWithin
  };
}

export function enaCorrelations(set: ENASet, dims?: Array<number | string>, confLevel = 0.95): DimensionCorrelation[] {
  if (!set.centroids) throw new Error('ENA set does not include centroids.');
  const names = dimensionNames(set, dims);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < set.points.length; i += 1) {
    for (let j = i + 1; j < set.points.length; j += 1) pairs.push([i, j]);
  }

  return names.map((dimension) => {
    const pointValues = values(set.points, dimension);
    const centroidValues = values(set.centroids ?? [], dimension);
    const pointDiff = pairs.map(([left, right]) => (pointValues[left] ?? 0) - (pointValues[right] ?? 0));
    const centroidDiff = pairs.map(([left, right]) => (centroidValues[left] ?? 0) - (centroidValues[right] ?? 0));
    const pearson = pearsonCorrelation(pointDiff, centroidDiff);
    const spearman = pearsonCorrelation(ranks(pointDiff), ranks(centroidDiff));
    const [pearsonLower, pearsonUpper] = confidenceInterval(pearson, pairs.length, confLevel);
    return { dimension, pearson, spearman, pearsonLower, pearsonUpper };
  });
}

export function cohensD(x: number[], y: number[]): number {
  return coreCohensD(x, y);
}

export function dimensionSummary(set: ENASet, dims?: Array<number | string>): DimensionSummaryRow[] {
  return dimensionNames(set, dims).map((dimension) => {
    const vals = finiteValues(set.points, dimension);
    const variance = sampleVariance(vals);
    return {
      dimension,
      n: vals.length,
      mean: mean(vals),
      sd: Math.sqrt(variance),
      variance,
      min: vals.length === 0 ? Number.NaN : Math.min(...vals),
      max: vals.length === 0 ? Number.NaN : Math.max(...vals)
    };
  });
}

export function groupSummary(set: ENASet, by: string, dims?: Array<number | string>): GroupSummaryRow[] {
  const names = dimensionNames(set, dims);
  const groups = new Map<string, Row[]>();
  for (const row of set.points) {
    const key = String((row[by] ?? null) as Scalar);
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()].map(([group, rows]) => ({
    group,
    n: rows.length,
    means: Object.fromEntries(names.map((dimension) => {
      const vals = values(rows, dimension);
      return [dimension, vals.reduce((sum, value) => sum + value, 0) / vals.length];
    }))
  }));
}

export function enaStats(set: ENASet, options: ENAStatsOptions = {}): ENAStatsResult {
  const dimensions = dimensionSummary(set, options.dims);
  const correlations = enaCorrelations(set, options.dims, options.confLevel ?? 0.95);
  if (!options.by) return { dimensions, correlations };
  const groups = groupSummary(set, options.by, options.dims);
  const tests = dimensionNames(set, options.dims).flatMap((dimension) => {
    const grouped = [...groupedPointValues(set, options.by ?? '', dimension).entries()];
    const test = grouped.length === 2 ? welchTTest(dimension, grouped) : oneWayAnova(dimension, grouped);
    return test ? [test] : [];
  });
  return { dimensions, correlations, groups, tests };
}
