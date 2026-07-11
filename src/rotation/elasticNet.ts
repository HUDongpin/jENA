import type { Matrix } from '../types.js';
import { multiplyMatrices, transpose } from '../core/matrix.js';

export interface ElasticNetOptions {
  alpha?: number;
  lambda?: number;
  maxIterations?: number;
  tolerance?: number;
  penaltyFactor?: number[];
}

export interface ElasticNetCVOptions extends ElasticNetOptions {
  lambdas?: number[];
  folds?: number;
}

export interface ElasticNetResult {
  coefficients: Matrix;
  lambda: number;
}

function softThreshold(value: number, penalty: number): number {
  if (value > penalty) return value - penalty;
  if (value < -penalty) return value + penalty;
  return 0;
}

function squaredNormColumn(matrix: Matrix, col: number): number {
  return matrix.reduce((sum, row) => {
    const value = row[col] ?? 0;
    return sum + value * value;
  }, 0);
}

function responseColumn(response: Matrix, col: number): number[] {
  return response.map((row) => row[col] ?? 0);
}

function fitColumn(design: Matrix, response: number[], options: Required<ElasticNetOptions>): number[] {
  const rows = design.length;
  const cols = design[0]?.length ?? 0;
  const beta = Array.from({ length: cols }, () => 0);
  beta[0] = response.reduce((sum, value) => sum + value, 0) / Math.max(1, rows);
  const predicted = Array.from({ length: rows }, () => beta[0] ?? 0);
  const columnNorms = Array.from({ length: cols }, (_unused, col) => squaredNormColumn(design, col) / Math.max(1, rows));

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    let maxChange = 0;
    for (let col = 0; col < cols; col += 1) {
      const penaltyFactor = options.penaltyFactor[col] ?? 1;
      const old = beta[col] ?? 0;
      let rho = 0;
      for (let row = 0; row < rows; row += 1) {
        const x = design[row]?.[col] ?? 0;
        rho += x * ((response[row] ?? 0) - (predicted[row] ?? 0) + x * old);
      }
      rho /= Math.max(1, rows);
      const denom = (columnNorms[col] ?? 0) + options.lambda * (1 - options.alpha) * penaltyFactor;
      const next = col === 0 || penaltyFactor === 0
        ? rho / (denom === 0 ? 1e-12 : denom)
        : softThreshold(rho, options.lambda * options.alpha * penaltyFactor) / (denom === 0 ? 1e-12 : denom);
      beta[col] = next;
      const delta = next - old;
      maxChange = Math.max(maxChange, Math.abs(delta));
      if (delta !== 0) {
        for (let row = 0; row < rows; row += 1) {
          predicted[row] = (predicted[row] ?? 0) + (design[row]?.[col] ?? 0) * delta;
        }
      }
    }
    if (maxChange < options.tolerance) break;
  }
  return beta;
}

export function elasticNet(design: Matrix, response: Matrix, options: ElasticNetOptions = {}): ElasticNetResult {
  const fullOptions: Required<ElasticNetOptions> = {
    alpha: options.alpha ?? 1,
    lambda: options.lambda ?? 0.01,
    maxIterations: options.maxIterations ?? 1_000,
    tolerance: options.tolerance ?? 1e-8,
    penaltyFactor: options.penaltyFactor ?? Array.from({ length: design[0]?.length ?? 0 }, (_unused, index) => (index === 0 ? 0 : 1))
  };
  const columns = response[0]?.length ?? 0;
  const coefficients = Array.from({ length: columns }, (_unused, col) => fitColumn(design, responseColumn(response, col), fullOptions));
  return { coefficients: transpose(coefficients), lambda: fullOptions.lambda };
}

function subsetRows(matrix: Matrix, indexes: number[]): Matrix {
  return indexes.map((index) => matrix[index] ?? []);
}

function mse(actual: Matrix, predicted: Matrix): number {
  let total = 0;
  let count = 0;
  for (let row = 0; row < actual.length; row += 1) {
    for (let col = 0; col < (actual[row]?.length ?? 0); col += 1) {
      const diff = (actual[row]?.[col] ?? 0) - (predicted[row]?.[col] ?? 0);
      total += diff * diff;
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

export function elasticNetCV(design: Matrix, response: Matrix, options: ElasticNetCVOptions = {}): ElasticNetResult {
  const rows = design.length;
  const folds = Math.max(2, Math.min(options.folds ?? 5, rows));
  const lambdas = options.lambdas ?? [1, 0.3, 0.1, 0.03, 0.01, 0.003, 0.001];
  let bestLambda = lambdas[0] ?? 0.01;
  let bestMse = Number.POSITIVE_INFINITY;
  const indexes = Array.from({ length: rows }, (_unused, index) => index);

  for (const lambda of lambdas) {
    let total = 0;
    for (let fold = 0; fold < folds; fold += 1) {
      const test = indexes.filter((index) => index % folds === fold);
      const train = indexes.filter((index) => index % folds !== fold);
      const fit = elasticNet(subsetRows(design, train), subsetRows(response, train), { ...options, lambda });
      total += mse(subsetRows(response, test), multiplyMatrices(subsetRows(design, test), fit.coefficients));
    }
    const score = total / folds;
    if (score < bestMse) {
      bestMse = score;
      bestLambda = lambda;
    }
  }
  return elasticNet(design, response, { ...options, lambda: bestLambda });
}
