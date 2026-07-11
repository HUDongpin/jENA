/*
 * Derived from rENA 0.3.1 (GPL-3), (c) the rENA authors: Cody L Marquart,
 * Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and
 * David Williamson Shaffer. This file ports R/ena.rotate.by.mean.R; the
 * generalized/regression/hena/spherical rotations are unverified
 * approximations of their R counterparts.
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
import { elasticNetCV } from './elasticNet.js';

interface FormulaSpec {
  lhs: string;
  rhsTerms: string[];
}

interface GmrResult {
  direction: number[];
  fittedMainEffect: Matrix;
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
  let fittedMainEffect = numericTarget ? simple.fitted : categoricalMainEffect(points, target);

  if (vars.length > 1) {
    const design = buildMetadataDesign(rows, vars);
    const x1Columns = design.labels.map((label, index) => index === 0 || label === (vars[0] ?? '') ? 0 : 1);
    const coefficients = elasticNetCV(design.matrix, points, { alpha: 1, penaltyFactor: x1Columns }).coefficients;
    const targetOnly = design.matrix.map((row) => row.map((value, index) => (index <= 1 ? value : 0)));
    fittedMainEffect = multiplyMatrices(targetOnly, coefficients);
  }

  if (numericTarget) {
    return {
      direction: normalizeVector(simple.coefficients[1] ?? []),
      fittedMainEffect,
      target
    };
  }

  const scatter = computeBetweenGroupScatter(fittedMainEffect, target);
  const eigen = symmetricJacobiEigen(scatter);
  return {
    direction: normalizeVector(eigen.eigenvectors.map((row) => row[0] ?? 0)),
    fittedMainEffect,
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
    const svd = svdRotation(x.fittedMainEffect);
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
  const deflatedByBoth = subtractOuterProjection(subtractOuterProjection(a, x.direction), yDirection);
  const residual = svdRotation(deflatedByBoth).rotationMatrix;
  const residualCount = Math.max(0, (a[0]?.length ?? 0) - 2);
  const columns = [x.direction, normalizeVector(yDirection)];
  for (let index = 0; index < residualCount; index += 1) columns.push(residual.map((row) => row[index] ?? 0));
  return {
    rotationMatrix: combineRotationColumns(columns).map((row) => row.slice(0, a[0]?.length ?? 0)),
    rotationColumns: ['RR1', yName, ...makeColumnNames('SVD', residualCount, 3)],
    eigenvalues: []
  };
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
  const x = firstPredictorVectorFromRegression(pointsForProjection, enadata.metaData, params.xVar, enadata.codeColumns[0] ?? 'V');
  let deflated = subtractOuterProjection(pointsForProjection, x.vector);
  const columns = [x.vector];
  const names = [x.name];
  if (params.yVar) {
    const y = firstPredictorVectorFromRegression(deflated, enadata.metaData, params.yVar, enadata.codeColumns[0] ?? 'V');
    columns.push(y.vector);
    names.push(y.name);
    deflated = subtractOuterProjection(deflated, y.vector);
  }
  return rotateWithLeadingColumns(deflated, columns, names);
}

export function rotateByRegression2(pointsForProjection: Matrix, enadata: ENAData, params: RegressionRotationParams): SvdRotationResult {
  const x = vCoefficientVectorFromRegression(pointsForProjection, enadata.metaData, params.xVar);
  let deflated = subtractOuterProjection(pointsForProjection, x.vector);
  const columns = [x.vector];
  const names = [x.name];
  if (params.yVar) {
    const y = vCoefficientVectorFromRegression(deflated, enadata.metaData, params.yVar);
    columns.push(y.vector);
    names.push(y.name);
    deflated = subtractOuterProjection(deflated, y.vector);
  }
  return rotateWithLeadingColumns(deflated, columns, names);
}

function henaPredictorColumns(rows: Row[], params: HenaRotationParams): { matrix: Matrix; names: string[]; both: string[] } {
  const centering = params.centering ?? true;
  const both = [params.xVar, ...(params.yVar ? [params.yVar] : [])];
  const controlVars = params.controlVars ?? [];
  const vars = params.formula
    ? parseFormula(`V ~ ${params.formula}`).rhsTerms
    : [...both, ...controlVars, ...(params.includeXY && params.yVar ? [`${params.xVar}:${params.yVar}`] : [])];
  const encoded = new Map<string, number[]>();
  for (const name of [...new Set(vars.flatMap((term) => term.split(':').map((piece) => piece.trim())))]) {
    if (!name) continue;
    const values = encodeVector(metadataVector(rows, name));
    const mean = both.includes(name) && centering ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    encoded.set(name, values.map((value) => value - mean));
  }

  const columns: number[][] = [Array.from({ length: rows.length }, () => 1)];
  const names = ['(Intercept)'];
  for (const term of vars) {
    const pieces = term.split(':').map((piece) => piece.trim()).filter(Boolean);
    const columnValues = pieces.reduce(
      (current, piece) => current.map((value, index) => value * (encoded.get(piece)?.[index] ?? 0)),
      Array.from({ length: rows.length }, () => 1)
    );
    columns.push(columnValues);
    names.push(term);
  }
  return { matrix: columnsToMatrix(columns, rows.length), names, both };
}

export function rotateByHena(pointsForProjection: Matrix, enadata: ENAData, params: HenaRotationParams): SvdRotationResult {
  const data = centerData(pointsForProjection);
  const design = henaPredictorColumns(enadata.metaData, params);
  const coefficients = designSolve(design.matrix, data);
  const leadingColumns: number[][] = [];
  const leadingNames: string[] = [];
  for (const variableName of design.both) {
    const coefficientIndex = design.names.indexOf(variableName);
    if (coefficientIndex < 0) continue;
    let vector = coefficients[coefficientIndex] ?? [];
    for (const previous of leadingColumns) {
      vector = subtractVectors(vector, previous.map((value) => value * dot(vector, previous)));
    }
    vector = normalizeVector(vector);
    if (l2Norm(vector) > 0) {
      leadingColumns.push(vector);
      leadingNames.push(`${leadingColumns.length === 1 ? 'x' : 'y'}_${variableName}`);
    }
  }
  if (leadingColumns.length === 0) throw new Error('HENA rotation could not derive a non-zero rotation vector.');
  const deflated = deflateMatrix(data, leadingColumns);
  const result = rotateWithLeadingColumns(deflated, leadingColumns, leadingNames);
  const svd = svdRotation(deflated);
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
