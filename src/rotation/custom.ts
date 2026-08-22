/*
 * Derived from rENA 0.3.1 (GPL-3), (c) the rENA authors: Cody L Marquart,
 * Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and
 * David Williamson Shaffer. This file ports R/ena.rotate.by.mean.R. The
 * documented regression, regression2, generalized, and hena configurations
 * are verified against pinned rENA goldens; spherical is a jena extension with
 * no rENA counterpart. Ordered-network product entry points reject all custom
 * rotations in the current descriptive SVD-only phase.
 * TypeScript translation and modifications for jena-js, GPL-3.0-only.
 * See PROVENANCE.md for the upstream NOTICE and version pin.
 */
import type {
  ENAData,
  GeneralizedRotationParams,
  GroupSelector,
  HenaRotationParams,
  Matrix,
  MeanRotationParams,
  RegressionRotationParams,
  Row,
  Scalar
} from '../types.js';
import {
  centerData,
  dot,
  l2Norm,
  meanColumns,
  multiplyMatrices,
  subtractVectors
} from '../core/matrix.js';
import {
  designSolve,
  gramSchmidtComplete,
  matrixSubtract,
  normalizeVector,
  subtractOuterProjection,
  symmetricJacobiEigen
} from '../core/linear.js';
import { svdRotation, type SvdRotationResult } from './svd.js';
import { multiGaussianElasticNetCV } from './elasticNet.js';

interface FormulaSpec {
  lhs: string;
  rhsTerms: string[];
}

interface GmrResult {
  direction: number[];
  fittedMainEffect: Matrix;
  /** lm(V ~ target) fit before any covariate adjustment (rENA's Vx1). */
  fittedUnadjusted: Matrix;
  target: Scalar[];
}

interface DesignResult {
  matrix: Matrix;
  labels: string[];
}

function isBooleanSelector(selector: GroupSelector): selector is boolean[] {
  return selector.every((value) => typeof value === 'boolean');
}

function groupMask(selector: GroupSelector, rows: Row[]): boolean[] {
  if (isBooleanSelector(selector)) {
    if (selector.length !== rows.length) throw new Error('Group selector length must match row count.');
    return selector;
  }
  const values = new Set(selector.map(String));
  return rows.map((row) => values.has(String(row.ENA_UNIT ?? row.unit ?? '')));
}

function isSelector(value: unknown): value is GroupSelector {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' || typeof entry === 'boolean');
}

function normalizeMeanGroups(groups: MeanRotationParams['groups']): Array<[GroupSelector, GroupSelector]> {
  if (Array.isArray(groups) && groups.length === 2 && isSelector(groups[0]) && isSelector(groups[1])) {
    return [[groups[0], groups[1]]];
  }
  return groups as Array<[GroupSelector, GroupSelector]>;
}

function rowsByMask(matrix: Matrix, mask: boolean[]): Matrix {
  return matrix.filter((_row, index) => mask[index] ?? false);
}

function columnsToMatrix(columns: number[][], rows: number): Matrix {
  return Array.from({ length: rows }, (_unused, row) => columns.map((col) => col[row] ?? 0));
}

function combineRotationColumns(columns: number[][]): Matrix {
  const rowCount = columns[0]?.length ?? 0;
  return columnsToMatrix(columns, rowCount);
}

function orthogonalSvd(data: Matrix, leadingColumns: number[][]): Matrix {
  const width = data[0]?.length ?? 0;
  if (width === 0) return [];
  const q = gramSchmidtComplete(leadingColumns, width);
  const leadingCount = leadingColumns.length;
  const qLeading = q.map((row) => row.slice(0, leadingCount));
  const qRest = q.map((row) => row.slice(leadingCount));
  if ((qRest[0]?.length ?? 0) === 0) return qLeading;
  const xbar = multiplyMatrices(data, qRest);
  const restRotation = svdRotation(xbar).rotationMatrix;
  const rest = multiplyMatrices(qRest, restRotation);
  return q.map((_row, index) => [...(qLeading[index] ?? []), ...(rest[index] ?? [])]);
}

function makeColumnNames(prefix: string, count: number, start = 1): string[] {
  return Array.from({ length: count }, (_unused, index) => `${prefix}${index + start}`);
}

// R's make.unique semantics: repeated names gain .1, .2, ... suffixes, which
// is how rENA's duplicate regression column names surface in its data frames
// (and keeps Row keys from colliding here).
function makeUniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}.${count}`;
  });
}

/**
 * rENA's regression/generalized rotation assembly: deflate the points
 * sequentially by each leading vector, complete the basis with the SVD of
 * the deflated data, and DO NOT re-orthogonalize the leading vectors
 * themselves (matching ena.rotate.by.hena.regression / .generalized).
 *
 * One deliberate improvement over rENA: only directions genuinely spanned by
 * the deflated data are taken from its SVD; the rest of the basis is
 * completed orthogonally to everything already kept, so numerically-null
 * directions carry exactly zero data variance. rENA (via prcomp/LAPACK)
 * returns an arbitrary null-space basis instead, which can silently absorb a
 * share of the variance and contaminate every reported share — see
 * NUMERICS.md.
 */
function assembleRotation(points: Matrix, leading: number[][], leadingNames: string[]): SvdRotationResult {
  const width = points[0]?.length ?? 0;
  let deflated = points;
  for (const vector of leading) deflated = subtractOuterProjection(deflated, vector);
  const svd = svdRotation(deflated);
  const leadingEigenvalue = svd.eigenvalues[0] ?? 0;
  const rankThreshold = Math.max(Number.MIN_VALUE, leadingEigenvalue * 1e-12);
  const significant = Math.min(
    svd.eigenvalues.filter((value) => value > rankThreshold).length,
    Math.max(0, width - leading.length)
  );
  const columns = [...leading];
  for (let index = 0; index < significant; index += 1) {
    columns.push(svd.rotationMatrix.map((row) => row[index] ?? 0));
  }
  const completed = gramSchmidtComplete(columns, width);
  for (let index = columns.length; index < width; index += 1) {
    columns.push(completed.map((row) => row[index] ?? 0));
  }
  const residualCount = Math.max(0, width - leading.length);
  return {
    rotationMatrix: combineRotationColumns(columns),
    rotationColumns: makeUniqueNames([...leadingNames, ...makeColumnNames('SVD', residualCount, leading.length + 1)]),
    eigenvalues: []
  };
}

function rotateWithLeadingColumns(data: Matrix, leadingColumns: number[][], leadingNames: string[]): SvdRotationResult {
  const rotationMatrix = orthogonalSvd(data, leadingColumns);
  const residualCount = Math.max(0, (rotationMatrix[0]?.length ?? 0) - leadingNames.length);
  return {
    rotationMatrix,
    rotationColumns: [...leadingNames, ...makeColumnNames('SVD', residualCount, leadingNames.length + 1)],
    eigenvalues: []
  };
}

export function rotateByMean(pointsForProjection: Matrix, enadata: ENAData, params: MeanRotationParams): SvdRotationResult {
  const groups = normalizeMeanGroups(params.groups);
  if (groups.length === 0) throw new Error('Unable to rotate without at least one pair of groups.');
  const rows = enadata.connectionCounts;
  const data = centerData(pointsForProjection);
  let deflated = data;
  const weights: number[][] = [];

  for (const [leftSelector, rightSelector] of groups) {
    const left = rowsByMask(deflated, groupMask(leftSelector, rows));
    const right = rowsByMask(deflated, groupMask(rightSelector, rows));
    if (left.length === 0 || right.length === 0) throw new Error('Mean rotation groups must both contain at least one row.');
    const diff = subtractVectors(meanColumns(left), meanColumns(right));
    const direction = normalizeVector(diff);
    if (l2Norm(direction) === 0) throw new Error('Mean rotation groups have identical means.');
    deflated = subtractOuterProjection(deflated, direction);
    weights.push(direction);
  }

  return rotateWithLeadingColumns(deflated, weights, makeColumnNames('MR', weights.length));
}

function scalarToNumber(value: Scalar): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function metadataVector(rows: Row[], columnName: string): Scalar[] {
  return rows.map((row) => row[columnName] ?? null);
}

function encodeVector(values: Scalar[]): number[] {
  const numeric = values.map(scalarToNumber);
  if (numeric.every(Number.isFinite)) return numeric;
  const levels = [...new Set(values.map((value) => String(value)))].sort();
  return values.map((value) => levels.indexOf(String(value)) + 1);
}

function isNumericVector(values: Scalar[]): boolean {
  return values.map(scalarToNumber).every(Number.isFinite);
}

function resolveVarNames(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function simpleLinearFit(response: Matrix, predictor: number[]): { coefficients: Matrix; fitted: Matrix } {
  const design = predictor.map((value) => [1, value]);
  const coefficients = designSolve(design, response);
  return { coefficients, fitted: multiplyMatrices(design, coefficients) };
}

function categoricalMainEffect(response: Matrix, target: Scalar[]): Matrix {
  const levels = [...new Set(target.map((value) => String(value)))];
  const means = new Map<string, number[]>();
  for (const level of levels) {
    const rows = response.filter((_row, index) => String(target[index] ?? '') === level);
    means.set(level, meanColumns(rows));
  }
  return response.map((_row, index) => means.get(String(target[index] ?? '')) ?? []);
}

function computeBetweenGroupScatter(matrix: Matrix, groups: Scalar[]): Matrix {
  const width = matrix[0]?.length ?? 0;
  const totalMean = meanColumns(matrix);
  const out = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const levels = [...new Set(groups.map((value) => String(value)))];
  for (const level of levels) {
    const rows = matrix.filter((_row, index) => String(groups[index] ?? '') === level);
    if (rows.length === 0) continue;
    const diff = subtractVectors(meanColumns(rows), totalMean);
    for (let i = 0; i < width; i += 1) {
      for (let j = 0; j < width; j += 1) {
        const outRow = out[i];
        if (outRow) outRow[j] = (outRow[j] ?? 0) + rows.length * (diff[i] ?? 0) * (diff[j] ?? 0);
      }
    }
  }
  return out;
}

function gmr(points: Matrix, rows: Row[], vars: string[]): GmrResult {
  const target = metadataVector(rows, vars[0] ?? '');
  const targetEncoded = encodeVector(target);
  const numericTarget = isNumericVector(target);
  const simple = simpleLinearFit(points, targetEncoded);
  const fittedUnadjusted = numericTarget ? simple.fitted : categoricalMainEffect(points, target);
  let fittedMainEffect = fittedUnadjusted;

  if (vars.length > 1) {
    // Mirrors rENA's get_x1_main_effect: a multivariate elastic net with the
    // target predictor unpenalized (penalty factor 0), the fitted main
    // effect being the target column times its coefficients — WITHOUT the
    // intercept. rENA selects lambda via cv.glmnet with randomized folds;
    // jena's CV is deterministic (see NUMERICS.md), so lambda selection can
    // differ from any particular rENA run while the solver itself matches
    // glmnet at equal lambda.
    const design = buildMetadataDesign(rows, vars);
    const predictors = design.matrix.map((row) => row.slice(1));
    const predictorLabels = design.labels.slice(1);
    const penaltyFactor = predictorLabels.map((label) => (label === (vars[0] ?? '') ? 0 : 1));
    const fit = multiGaussianElasticNetCV(predictors, points, { alpha: 1, penaltyFactor });
    const x1Index = predictorLabels.indexOf(vars[0] ?? '');
    const x1Coefficients = fit.coefficients[x1Index] ?? [];
    fittedMainEffect = predictors.map((row) => x1Coefficients.map((coefficient) => (row[x1Index] ?? 0) * coefficient));
  }

  if (numericTarget) {
    return {
      direction: normalizeVector(simple.coefficients[1] ?? []),
      fittedMainEffect,
      fittedUnadjusted,
      target
    };
  }

  const scatter = computeBetweenGroupScatter(fittedMainEffect, target);
  const eigen = symmetricJacobiEigen(scatter);
  return {
    direction: normalizeVector(eigen.eigenvectors.map((row) => row[0] ?? 0)),
    fittedMainEffect,
    fittedUnadjusted,
    target
  };
}

export function rotateByGeneralized(pointsForProjection: Matrix, enadata: ENAData, params: GeneralizedRotationParams): SvdRotationResult {
  const x = gmr(pointsForProjection, enadata.metaData, resolveVarNames(params.xVar));
  const a = pointsForProjection;
  let deflated = subtractOuterProjection(a, x.direction);

  let x1: number[] | undefined;
  if (params.select2Groups) {
    const [left, right] = params.select2Groups;
    const leftRows = deflated.filter((_row, index) => String(x.target[index] ?? '') === String(left));
    const rightRows = deflated.filter((_row, index) => String(x.target[index] ?? '') === String(right));
    if (leftRows.length > 0 && rightRows.length > 0) {
      const diff = subtractVectors(meanColumns(leftRows), meanColumns(rightRows));
      if (l2Norm(diff) > 1e-10) x1 = normalizeVector(diff);
    }
  }

  if (!x1) {
    // rENA: x1 = svd(Vx1)$v[,1], the leading right singular vector of the
    // UNADJUSTED lm(V ~ target) fit (not the covariate-adjusted effect).
    const svd = svdRotation(x.fittedUnadjusted);
    x1 = svd.rotationMatrix.map((row) => row[0] ?? 0);
  }

  const projection = dot(x1, x.direction);
  if (Math.abs(projection) < 0.99) {
    x1 = normalizeVector(subtractVectors(x1, x.direction.map((value) => value * projection)));
    deflated = subtractOuterProjection(deflated, x1);
  }

  const yDirection = params.yVar
    ? gmr(deflated, enadata.metaData, resolveVarNames(params.yVar)).direction
    : svdRotation(deflated).rotationMatrix.map((row) => row[0] ?? 0);
  const yName = params.yVar ? 'RR2' : 'SVD2';
  // rENA's final deflation is by x and y only (the intermediate x1 deflation
  // does not appear in the completed basis).
  return assembleRotation(a, [x.direction, normalizeVector(yDirection)], ['RR1', yName]);
}

function stripLmWrapper(formula: string): string {
  const match = formula.match(/formula\s*=\s*([^,)]+)/);
  if (match?.[1]) return match[1].trim();
  return formula.replace(/^lm\s*\(/, '').replace(/\)$/, '').trim();
}

function parseFormula(formula: string): FormulaSpec {
  const stripped = stripLmWrapper(formula);
  const [lhsRaw, rhsRaw] = stripped.split('~');
  const lhs = lhsRaw?.trim();
  const rhs = rhsRaw?.trim();
  if (!lhs || !rhs) throw new Error(`Invalid regression formula: ${formula}`);
  return {
    lhs,
    rhsTerms: rhs.split('+').map((term) => term.trim()).filter(Boolean)
  };
}

function buildMetadataDesign(rows: Row[], terms: string[]): DesignResult {
  const columns: number[][] = [Array.from({ length: rows.length }, () => 1)];
  const labels = ['(Intercept)'];
  for (const term of terms) {
    const pieces = term.split(':').map((piece) => piece.trim());
    let values = Array.from({ length: rows.length }, () => 1);
    for (const piece of pieces) {
      const encoded = encodeVector(metadataVector(rows, piece));
      values = values.map((value, index) => value * (encoded[index] ?? 0));
    }
    columns.push(values);
    labels.push(term);
  }
  return { matrix: columnsToMatrix(columns, rows.length), labels };
}

function buildFormulaDesign(rows: Row[], points: Matrix, terms: string[]): DesignResult {
  const columns: number[][] = [Array.from({ length: rows.length }, () => 1)];
  const labels = ['(Intercept)'];
  for (const term of terms) {
    const pieces = term.split(':').map((piece) => piece.trim());
    const hasV = pieces.includes('V');
    const nonV = pieces.filter((piece) => piece !== 'V');
    const metaMultiplier = nonV.reduce(
      (current, piece) => {
        const encoded = encodeVector(metadataVector(rows, piece));
        return current.map((value, index) => value * (encoded[index] ?? 0));
      },
      Array.from({ length: rows.length }, () => 1)
    );

    if (hasV) {
      const width = points[0]?.length ?? 0;
      for (let dim = 0; dim < width; dim += 1) {
        columns.push(points.map((row, index) => (row[dim] ?? 0) * (metaMultiplier[index] ?? 1)));
        labels.push(nonV.length > 0 ? `V${dim + 1}:${nonV.join(':')}` : `V${dim + 1}`);
      }
    } else {
      columns.push(metaMultiplier);
      labels.push(term);
    }
  }
  return { matrix: columnsToMatrix(columns, rows.length), labels };
}

function firstPredictorVectorFromRegression(points: Matrix, rows: Row[], formula: string, fallbackName: string): { vector: number[]; name: string } {
  const spec = parseFormula(formula);
  const design = buildMetadataDesign(rows, spec.rhsTerms);
  const coefficients = designSolve(design.matrix, points);
  return {
    vector: normalizeVector(coefficients[1] ?? []),
    name: `${fallbackName || design.labels[1] || spec.lhs}_reg`
  };
}

function vCoefficientVectorFromRegression(points: Matrix, rows: Row[], formula: string): { vector: number[]; name: string } {
  const spec = parseFormula(formula);
  const design = buildFormulaDesign(rows, points, spec.rhsTerms);
  const response = encodeVector(metadataVector(rows, spec.lhs)).map((value) => [value]);
  const coefficients = designSolve(design.matrix, response);
  const vCoefficients = design.labels
    .map((label, index) => ({ label, value: coefficients[index]?.[0] ?? 0 }))
    .filter((entry) => entry.label.startsWith('V') && !entry.label.includes(':'))
    .map((entry) => entry.value);
  return {
    vector: normalizeVector(vCoefficients),
    name: 'V_reg'
  };
}

export function rotateByRegression(pointsForProjection: Matrix, enadata: ENAData, params: RegressionRotationParams): SvdRotationResult {
  const fallbackName = enadata.codeColumns[0] ?? 'V';
  const x = firstPredictorVectorFromRegression(pointsForProjection, enadata.metaData, params.xVar, fallbackName);
  const columns = [x.vector];
  const names = [x.name];
  if (params.yVar) {
    // rENA evaluates the y formula with V rebound to the ORIGINAL points
    // (with.ena.matrix shadows the deflated copy), so the y direction is
    // also computed from the undeflated data.
    const y = firstPredictorVectorFromRegression(pointsForProjection, enadata.metaData, params.yVar, fallbackName);
    columns.push(y.vector);
    names.push(y.name);
  }
  return assembleRotation(pointsForProjection, columns, names);
}

export function rotateByRegression2(pointsForProjection: Matrix, enadata: ENAData, params: RegressionRotationParams): SvdRotationResult {
  const x = vCoefficientVectorFromRegression(pointsForProjection, enadata.metaData, params.xVar);
  const columns = [x.vector];
  const names = [x.name];
  if (params.yVar) {
    // Same V-shadowing as rotateByRegression: rENA's y regression sees the
    // original points, not the deflated ones.
    const y = vCoefficientVectorFromRegression(pointsForProjection, enadata.metaData, params.yVar);
    columns.push(y.vector);
    names.push(y.name);
  }
  return assembleRotation(pointsForProjection, columns, names);
}

// data.table::rleidv semantics: run-length group ids in row order, so a
// value that re-appears after a different value starts a NEW group. This is
// how rENA's ena.rotation.h dummy-codes categorical variables — faithful to
// upstream even though it only behaves like a conventional dummy code when
// the rows are sorted by that variable (see NUMERICS.md).
function runLengthEncode(values: Scalar[]): number[] {
  let id = -1;
  let previous: string | undefined;
  return values.map((value) => {
    const key = String(value);
    if (key !== previous) {
      id += 1;
      previous = key;
    }
    return id;
  });
}

function centerVectorValues(values: number[]): number[] {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return values.map((value) => value - mean);
}

function isNumericColumn(values: Scalar[]): boolean {
  return values.every((value) => typeof value === 'number' && Number.isFinite(value));
}

// lm-style treatment contrasts for a character control variable: one 0/1
// column per sorted level after the first (the reference level).
function factorContrastColumns(values: Scalar[], name: string): { columns: number[][]; names: string[] } {
  const levels = [...new Set(values.map((value) => String(value)))].sort();
  const columns: number[][] = [];
  const names: string[] = [];
  for (const level of levels.slice(1)) {
    columns.push(values.map((value) => (String(value) === level ? 1 : 0)));
    names.push(`${name}${level}`);
  }
  return { columns, names };
}

export function rotateByHena(pointsForProjection: Matrix, enadata: ENAData, params: HenaRotationParams): SvdRotationResult {
  // ena.rotation.h re-centers the (already centered-for-projection) values
  // by their plain column means before regressing and deflating.
  const data = centerData(pointsForProjection);
  const rows = enadata.metaData;
  const centering = params.centering ?? true;

  const encodeVariable = (name: string): { values: number[]; label: string } => {
    const raw = metadataVector(rows, name);
    if (isNumericColumn(raw)) return { values: raw.map((value) => Number(value)), label: name };
    // rENA renames dummy-coded variables with an _f suffix, which also shows
    // up in the rotation column names (x_group_f).
    return { values: runLengthEncode(raw), label: `${name}_f` };
  };

  const x = encodeVariable(params.xVar);
  const y = params.yVar ? encodeVariable(params.yVar) : undefined;
  if (centering) {
    x.values = centerVectorValues(x.values);
    if (y) y.values = centerVectorValues(y.values);
  }

  // Design: intercept, x, y, controls (character controls expand to lm-style
  // factor contrasts), then the optional centered x*y interaction.
  const columns: number[][] = [Array.from({ length: rows.length }, () => 1), x.values];
  if (y) columns.push(y.values);
  for (const control of params.controlVars ?? []) {
    const raw = metadataVector(rows, control);
    if (isNumericColumn(raw)) {
      columns.push(raw.map((value) => Number(value)));
    } else {
      columns.push(...factorContrastColumns(raw, control).columns);
    }
  }
  if (params.includeXY && y) {
    columns.push(x.values.map((value, index) => value * (y.values[index] ?? 0)));
  }

  const coefficients = designSolve(columnsToMatrix(columns, rows.length), data);
  const v1 = normalizeVector(coefficients[1] ?? []);
  if (l2Norm(v1) === 0) throw new Error('HENA rotation could not derive a non-zero rotation vector.');
  const leadingColumns = [v1];
  const leadingNames = [`x_${x.label}`];
  if (y) {
    const rawY = coefficients[2] ?? [];
    const orthogonalized = normalizeVector(subtractVectors(rawY, v1.map((value) => value * dot(rawY, v1))));
    if (l2Norm(orthogonalized) > 0) {
      leadingColumns.push(orthogonalized);
      leadingNames.push(`y_${y.label}`);
    }
  }

  const result = assembleRotation(data, leadingColumns, leadingNames);
  const svd = svdRotation(deflateMatrix(data, leadingColumns));
  return { ...result, eigenvalues: svd.eigenvalues };
}

function anchorVector(anchor: string | number[] | undefined, enadata: ENAData, width: number): number[] {
  if (Array.isArray(anchor)) {
    if (anchor.length !== width) throw new Error('Spherical rotation anchor length must match adjacency width.');
    return normalizeVector(anchor);
  }
  if (typeof anchor === 'string') {
    const index = enadata.codeColumns.indexOf(anchor);
    if (index < 0) throw new Error(`Unknown spherical rotation anchor: ${anchor}`);
    return Array.from({ length: width }, (_unused, col) => (col === index ? 1 : 0));
  }
  return Array.from({ length: width }, (_unused, col) => (col === 0 ? 1 : 0));
}

/**
 * jena-specific extension with NO rENA counterpart: anchors the first axis
 * at a chosen adjacency direction (a co-occurrence column name or a custom
 * vector), orthogonalizes an optional secondary anchor against it, and
 * completes the basis with the SVD of the orthogonal complement. Useful for
 * fixing an interpretable axis; spec-tested in tests/spherical.test.ts.
 */
export function rotateBySpherical(pointsForProjection: Matrix, enadata: ENAData, params: { anchor?: string | number[]; secondaryAnchor?: string | number[] } = {}): SvdRotationResult {
  const width = pointsForProjection[0]?.length ?? 0;
  const first = anchorVector(params.anchor, enadata, width);
  let second = anchorVector(params.secondaryAnchor, enadata, width);
  second = normalizeVector(subtractVectors(second, first.map((value) => value * dot(second, first))));
  const leading = l2Norm(second) > 0 ? [first, second] : [first];
  const deflated = deflateMatrix(pointsForProjection, leading);
  return rotateWithLeadingColumns(deflated, leading, leading.map((_column, index) => `SPH${index + 1}`));
}

export function projectRotation(pointsForProjection: Matrix, rotationMatrix: Matrix): Matrix {
  return multiplyMatrices(pointsForProjection, rotationMatrix);
}

export function deflateMatrix(matrix: Matrix, vectors: number[][]): Matrix {
  return vectors.reduce((current, vector) => subtractOuterProjection(current, vector), matrix);
}

export function residualMatrix(matrix: Matrix, fitted: Matrix): Matrix {
  return matrixSubtract(matrix, fitted);
}
