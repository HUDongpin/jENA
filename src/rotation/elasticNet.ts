import type { Matrix } from '../types.js';

// glmnet-compatible multivariate-gaussian elastic net (family = "mgaussian"):
// a GROUP lasso across the response columns — each predictor's coefficient
// vector over all responses is soft-thresholded jointly by its L2 norm,
// matching Friedman/Hastie/Tibshirani's multiresponse formulation. Verified
// against glmnet at fixed lambda values in tests/elasticnet-parity.test.ts.
// The lambda SELECTION used by rENA (cv.glmnet) randomizes fold assignment
// and is not reproducible even across rENA runs; multiGaussianElasticNetCV
// instead uses a deterministic round-robin fold assignment over a
// glmnet-style lambda path (see NUMERICS.md).

export interface MultiGaussianElasticNetOptions {
  /** Regularization strength (glmnet lambda). */
  lambda: number;
  /** Elastic-net mixing: 1 = lasso (default), 0 = ridge. */
  alpha?: number;
  /** Per-predictor penalty factors; rescaled to sum to the predictor count like glmnet. 0 forces a predictor in. */
  penaltyFactor?: number[];
  /** Scale predictors to unit 1/n-variance internally (glmnet default true); coefficients are returned on the original scale. */
  standardize?: boolean;
  maxIterations?: number;
  tolerance?: number;
}

export interface MultiGaussianElasticNetResult {
  /** Per-response intercepts. */
  intercepts: number[];
  /** Predictor-by-response coefficients on the original scale. */
  coefficients: Matrix;
  lambda: number;
}

export interface MultiGaussianElasticNetCVOptions extends Omit<MultiGaussianElasticNetOptions, 'lambda'> {
  /** Deterministic round-robin folds (row index modulo nfolds); default min(10, rows). */
  nfolds?: number;
  nlambda?: number;
  lambdaMinRatio?: number;
}

interface PreparedDesign {
  rows: number;
  cols: number;
  centered: Matrix;      // centered (and possibly scaled) predictors
  means: number[];
  scales: number[];      // 1 when not standardized or for zero-variance columns
  active: boolean[];     // false for zero-variance columns (coefficients stay 0)
  columnNorms: number[]; // (1/n) * sum(centered^2) per column
}

function prepareDesign(x: Matrix, standardize: boolean): PreparedDesign {
  const rows = x.length;
  const cols = x[0]?.length ?? 0;
  const means = Array.from({ length: cols }, (_unused, col) => {
    let total = 0;
    for (const row of x) total += row[col] ?? 0;
    return total / Math.max(1, rows);
  });
  const scales = Array.from({ length: cols }, () => 1);
  const active = Array.from({ length: cols }, () => true);
  const centered = x.map((row) => row.map((value, col) => value - (means[col] ?? 0)));
  for (let col = 0; col < cols; col += 1) {
    let sumSquares = 0;
    for (const row of centered) sumSquares += (row[col] ?? 0) ** 2;
    const sd = Math.sqrt(sumSquares / Math.max(1, rows));
    if (sd === 0) {
      active[col] = false;
      continue;
    }
    if (standardize) {
      scales[col] = sd;
      for (const row of centered) row[col] = (row[col] ?? 0) / sd;
    }
  }
  const columnNorms = Array.from({ length: cols }, (_unused, col) => {
    let sumSquares = 0;
    for (const row of centered) sumSquares += (row[col] ?? 0) ** 2;
    return sumSquares / Math.max(1, rows);
  });
  return { rows, cols, centered, means, scales, active, columnNorms };
}

function centerResponses(y: Matrix): { centered: Matrix; means: number[] } {
  const rows = y.length;
  const cols = y[0]?.length ?? 0;
  const means = Array.from({ length: cols }, (_unused, col) => {
    let total = 0;
    for (const row of y) total += row[col] ?? 0;
    return total / Math.max(1, rows);
  });
  return { centered: y.map((row) => row.map((value, col) => value - (means[col] ?? 0))), means };
}

// glmnet rescales penalty factors to sum to the number of predictors.
function rescalePenaltyFactors(penaltyFactor: number[] | undefined, cols: number): number[] {
  const raw = penaltyFactor ?? Array.from({ length: cols }, () => 1);
  if (raw.length !== cols) {
    throw new Error(`penaltyFactor must have one entry per predictor (${cols}); got ${raw.length}.`);
  }
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return raw.map(() => 0);
  return raw.map((value) => (value * cols) / total);
}

function solveStandardized(
  design: PreparedDesign,
  centeredY: Matrix,
  responses: number,
  lambda: number,
  alpha: number,
  penalty: number[],
  maxIterations: number,
  tolerance: number
): Matrix {
  const { rows, cols, centered, columnNorms, active } = design;
  const beta: Matrix = Array.from({ length: cols }, () => Array.from({ length: responses }, () => 0));
  const residual = centeredY.map((row) => [...row]);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let maxDelta = 0;
    for (let col = 0; col < cols; col += 1) {
      if (!active[col]) continue;
      const norm = columnNorms[col] ?? 0;
      const current = beta[col] ?? [];
      // u = (1/n) X_j' R + norm_j * beta_j  (the unpenalized minimizer direction)
      const u = Array.from({ length: responses }, (_unused, k) => {
        let total = 0;
        for (let row = 0; row < rows; row += 1) {
          total += (centered[row]?.[col] ?? 0) * (residual[row]?.[k] ?? 0);
        }
        return total / Math.max(1, rows) + norm * (current[k] ?? 0);
      });
      const uNorm = Math.sqrt(u.reduce((sum, value) => sum + value * value, 0));
      const groupPenalty = lambda * alpha * (penalty[col] ?? 1);
      const shrink = uNorm > groupPenalty ? 1 - groupPenalty / uNorm : 0;
      const denominator = norm + lambda * (1 - alpha) * (penalty[col] ?? 1);
      for (let k = 0; k < responses; k += 1) {
        const next = denominator > 0 ? ((u[k] ?? 0) * shrink) / denominator : 0;
        const delta = next - (current[k] ?? 0);
        if (delta !== 0) {
          for (let row = 0; row < rows; row += 1) {
            const residualRow = residual[row];
            if (residualRow) residualRow[k] = (residualRow[k] ?? 0) - (centered[row]?.[col] ?? 0) * delta;
          }
          current[k] = next;
          maxDelta = Math.max(maxDelta, Math.abs(delta));
        }
      }
    }
    if (maxDelta < tolerance) break;
  }
  return beta;
}

export function multiGaussianElasticNet(x: Matrix, y: Matrix, options: MultiGaussianElasticNetOptions): MultiGaussianElasticNetResult {
  const alpha = options.alpha ?? 1;
  const standardize = options.standardize ?? true;
  const maxIterations = options.maxIterations ?? 10_000;
  const tolerance = options.tolerance ?? 1e-12;
  const design = prepareDesign(x, standardize);
  const { centered: centeredY, means: yMeans } = centerResponses(y);
  const responses = y[0]?.length ?? 0;
  const penalty = rescalePenaltyFactors(options.penaltyFactor, design.cols);

  const standardizedBeta = solveStandardized(design, centeredY, responses, options.lambda, alpha, penalty, maxIterations, tolerance);

  // Back to the original predictor scale, then recover intercepts.
  const coefficients = standardizedBeta.map((row, col) => row.map((value) => value / (design.scales[col] ?? 1)));
  const intercepts = Array.from({ length: responses }, (_unused, k) => {
    let offset = 0;
    for (let col = 0; col < design.cols; col += 1) {
      offset += (coefficients[col]?.[k] ?? 0) * (design.means[col] ?? 0);
    }
    return (yMeans[k] ?? 0) - offset;
  });
  return { intercepts, coefficients, lambda: options.lambda };
}

function lambdaPath(design: PreparedDesign, centeredY: Matrix, alpha: number, penalty: number[], nlambda: number, minRatio: number): number[] {
  const responses = centeredY[0]?.length ?? 0;
  // glmnet guards the path computation for small alpha the same way.
  const effectiveAlpha = Math.max(alpha, 1e-3);
  let lambdaMax = 0;
  for (let col = 0; col < design.cols; col += 1) {
    if (!design.active[col] || (penalty[col] ?? 1) <= 0) continue;
    let sumSquares = 0;
    for (let k = 0; k < responses; k += 1) {
      let inner = 0;
      for (let row = 0; row < design.rows; row += 1) {
        inner += (design.centered[row]?.[col] ?? 0) * (centeredY[row]?.[k] ?? 0);
      }
      sumSquares += (inner / Math.max(1, design.rows)) ** 2;
    }
    lambdaMax = Math.max(lambdaMax, Math.sqrt(sumSquares) / (effectiveAlpha * (penalty[col] ?? 1)));
  }
  if (lambdaMax <= 0) lambdaMax = 1;
  const path: number[] = [];
  for (let index = 0; index < nlambda; index += 1) {
    path.push(lambdaMax * Math.pow(minRatio, index / (nlambda - 1)));
  }
  return path;
}

export function multiGaussianElasticNetCV(x: Matrix, y: Matrix, options: MultiGaussianElasticNetCVOptions = {}): MultiGaussianElasticNetResult & { lambdas: number[] } {
  const rows = x.length;
  const cols = x[0]?.length ?? 0;
  const alpha = options.alpha ?? 1;
  const standardize = options.standardize ?? true;
  const nfolds = Math.max(2, Math.min(options.nfolds ?? 10, rows));
  const nlambda = options.nlambda ?? 60;
  const minRatio = options.lambdaMinRatio ?? (rows < cols ? 1e-2 : 1e-4);

  const pathDesign = prepareDesign(x, standardize);
  const { centered: centeredY } = centerResponses(y);
  const penalty = rescalePenaltyFactors(options.penaltyFactor, cols);
  const lambdas = lambdaPath(pathDesign, centeredY, alpha, penalty, nlambda, minRatio);

  const netOptions = (lambda: number): MultiGaussianElasticNetOptions => {
    const base: MultiGaussianElasticNetOptions = { lambda, alpha, standardize };
    if (options.penaltyFactor !== undefined) base.penaltyFactor = options.penaltyFactor;
    if (options.maxIterations !== undefined) base.maxIterations = options.maxIterations;
    if (options.tolerance !== undefined) base.tolerance = options.tolerance;
    return base;
  };

  // Deterministic round-robin folds (documented divergence from cv.glmnet's
  // randomized assignment).
  const foldOf = (row: number): number => row % nfolds;
  let bestLambda = lambdas[0] ?? 1;
  let bestError = Number.POSITIVE_INFINITY;
  for (const lambda of lambdas) {
    let squaredError = 0;
    let count = 0;
    for (let fold = 0; fold < nfolds; fold += 1) {
      const trainX: Matrix = [];
      const trainY: Matrix = [];
      const testX: Matrix = [];
      const testY: Matrix = [];
      for (let row = 0; row < rows; row += 1) {
        (foldOf(row) === fold ? testX : trainX).push(x[row] ?? []);
        (foldOf(row) === fold ? testY : trainY).push(y[row] ?? []);
      }
      if (trainX.length === 0 || testX.length === 0) continue;
      const fit = multiGaussianElasticNet(trainX, trainY, netOptions(lambda));
      for (let row = 0; row < testX.length; row += 1) {
        for (let k = 0; k < (testY[row]?.length ?? 0); k += 1) {
          let predicted = fit.intercepts[k] ?? 0;
          for (let col = 0; col < cols; col += 1) {
            predicted += (fit.coefficients[col]?.[k] ?? 0) * (testX[row]?.[col] ?? 0);
          }
          squaredError += ((testY[row]?.[k] ?? 0) - predicted) ** 2;
          count += 1;
        }
      }
    }
    const meanError = squaredError / Math.max(1, count);
    if (meanError < bestError) {
      bestError = meanError;
      bestLambda = lambda;
    }
  }

  return { ...multiGaussianElasticNet(x, y, netOptions(bestLambda)), lambdas };
}
