/*
 * Derived from rENA 0.3.1 (GPL-3), (c) the rENA authors: Cody L Marquart,
 * Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and
 * David Williamson Shaffer. This file ports the model/centering/variance semantics
 * of R/ena.make.set.R.
 * TypeScript translation and modifications for jena-js, GPL-3.0-only.
 * See PROVENANCE.md for the upstream NOTICE and version pin.
 */
import type {
  ENAData,
  ENASet,
  MakeSetOptions,
  Matrix,
  Row,
  RotationSet
} from './types.js';
import { centerData, meanColumns, multiplyMatrices, sphereNorm, varianceColumns } from './core/matrix.js';
import { validateMakeSetOptions } from './core/validate.js';
import { svdRotation } from './rotation/svd.js';
import {
  centroidsAsRows,
  directedNodePositions,
  directedNodePositionsWithGroundResponseAdded,
  lwsLeastSquaresPositions,
  nodesAsRows,
  type NodePositionResult
} from './rotation/nodePositions.js';
import {
  rotateByGeneralized,
  rotateByHena,
  rotateByMean,
  rotateByRegression,
  rotateByRegression2,
  rotateBySpherical
} from './rotation/custom.js';

function nonCodePart(row: Row, codeColumns: string[]): Row {
  const codeSet = new Set(codeColumns);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !codeSet.has(key))) as Row;
}

function rowsFromMatrix(baseRows: Row[], codeColumns: string[], columns: string[], matrix: Matrix): Row[] {
  return baseRows.map((row, rowIndex) => ({
    ...nonCodePart(row, codeColumns),
    ...Object.fromEntries(columns.map((column, columnIndex) => [column, matrix[rowIndex]?.[columnIndex] ?? 0]))
  }));
}

function selectMatrixColumns(matrix: Matrix, count: number): Matrix {
  return matrix.map((row) => row.slice(0, count));
}

function rowHasSignal(row: number[]): boolean {
  return row.reduce((sum, value) => sum + value, 0) !== 0;
}

function centerForProjection(lineWeights: Matrix, centerAlignToOrigin: boolean, rotationSet?: RotationSet): { pointsForProjection: Matrix; centerVector: number[] } {
  if (rotationSet) {
    const centerVector = rotationSet.centerVector;
    return {
      centerVector,
      pointsForProjection: lineWeights.map((row) => (centerAlignToOrigin && !rowHasSignal(row)
        ? row.map(() => 0)
        : row.map((value, index) => value - (centerVector[index] ?? 0))))
    };
  }

  if (!centerAlignToOrigin) {
    const centerVector = meanColumns(lineWeights);
    return { pointsForProjection: centerData(lineWeights, centerVector), centerVector };
  }

  const nonZeroRows = lineWeights.filter(rowHasSignal);
  if (nonZeroRows.length === 0) {
    throw new Error('There were no co-occurrences of codes for any of the units within the model as defined.');
  }
  const centerVector = meanColumns(nonZeroRows);
  return {
    centerVector,
    pointsForProjection: lineWeights.map((row) => (rowHasSignal(row) ? row.map((value, index) => value - (centerVector[index] ?? 0)) : row.map(() => 0)))
  };
}

function adjacencyKeysEqual(left: ENAData['adjacencyKey'], right: ENAData['adjacencyKey']): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other?.source === entry.source &&
      other.target === entry.target &&
      other.sourceIndex === entry.sourceIndex &&
      other.targetIndex === entry.targetIndex;
  });
}

function makeRotation(enadata: ENAData, pointsForProjection: Matrix, options: MakeSetOptions): Pick<RotationSet, 'rotationMatrix' | 'rotationColumns' | 'eigenvalues'> {
  if (options.rotationSet) {
    if (!adjacencyKeysEqual(enadata.adjacencyKey, options.rotationSet.adjacencyKey)) {
      throw new Error('Rotation sets must have identical adjacency keys.');
    }
    return {
      rotationMatrix: options.rotationSet.rotationMatrix,
      rotationColumns: options.rotationSet.rotationColumns,
      eigenvalues: options.rotationSet.eigenvalues
    };
  }

  // RotationOptions is a discriminated union, so each branch's params are
  // narrowed at compile time (advisory F-012 — no casts).
  const rotation = options.rotation;
  if (!rotation || rotation.method === 'svd') return svdRotation(pointsForProjection);
  switch (rotation.method) {
    case 'mean':
      return rotateByMean(pointsForProjection, enadata, rotation.params);
    case 'generalized':
      return rotateByGeneralized(pointsForProjection, enadata, rotation.params);
    case 'regression':
      return rotateByRegression(pointsForProjection, enadata, rotation.params);
    case 'regression2':
      return rotateByRegression2(pointsForProjection, enadata, rotation.params);
    case 'hena':
      return rotateByHena(pointsForProjection, enadata, rotation.params);
    case 'spherical':
      return rotateBySpherical(pointsForProjection, enadata, rotation.params ?? {});
  }
}

function makeNodePositions(lineWeights: Matrix, points: Matrix, codeCount: number, options: MakeSetOptions): NodePositionResult {
  const method = options.nodePositionMethod ?? 'undirected';
  if (method !== 'undirected') {
    // This pipeline only accumulates undirected upper-triangle adjacency
    // vectors (n*(n-1)/2 columns); a directed solver needs n*n columns and
    // would otherwise return silently wrong coordinates (advisory F-003).
    const width = lineWeights[0]?.length ?? 0;
    if (width !== codeCount * codeCount) {
      throw new Error(
        `nodePositionMethod "${method}" requires a directed adjacency (${codeCount * codeCount} columns for ${codeCount} codes), ` +
        `but this model is undirected (${width} upper-triangle columns). Use nodePositionMethod: "undirected".`
      );
    }
  }
  switch (method) {
    case 'undirected':
      return lwsLeastSquaresPositions(lineWeights, points, codeCount);
    case 'directed':
      return directedNodePositions(lineWeights, points);
    case 'directed-ground-response':
      return directedNodePositionsWithGroundResponseAdded(lineWeights, points);
  }
}

export function makeSet(enadata: ENAData, options: MakeSetOptions = {}): ENASet {
  validateMakeSetOptions(options);
  const dimensions = options.dimensions ?? 2;
  const centerAlignToOrigin = options.centerAlignToOrigin ?? true;
  const lineWeightsMatrix = sphereNorm(enadata.connectionMatrix);
  const { pointsForProjection, centerVector } = centerForProjection(lineWeightsMatrix, centerAlignToOrigin, options.rotationSet);
  const rotationResult = makeRotation(enadata, pointsForProjection, options);
  const dimCount = Math.min(dimensions, rotationResult.rotationColumns.length);
  const dimensionNames = rotationResult.rotationColumns.slice(0, dimCount);
  // rENA projects onto the full rotation matrix (ena.make.set.R: points <-
  // points.for.projection %*% rotation.matrix) and normalizes variance across
  // ALL rotated dimensions; only display output is truncated to `dimensions`.
  const fullPointsMatrix = multiplyMatrices(pointsForProjection, rotationResult.rotationMatrix);
  const pointsMatrix = selectMatrixColumns(fullPointsMatrix, dimCount);
  const nodePositionResult = makeNodePositions(lineWeightsMatrix, pointsMatrix, enadata.codes.length, options);
  const variances = varianceColumns(fullPointsMatrix);
  const varianceTotal = variances.reduce((sum, value) => sum + value, 0);
  const variance = Object.fromEntries(rotationResult.rotationColumns.map((name, index) => [name, varianceTotal === 0 ? 0 : (variances[index] ?? 0) / varianceTotal]));

  const rotation: RotationSet = {
    codes: enadata.codes,
    adjacencyKey: enadata.adjacencyKey,
    rotationMatrix: rotationResult.rotationMatrix,
    rotationColumns: rotationResult.rotationColumns,
    eigenvalues: rotationResult.eigenvalues,
    centerVector,
    nodes: options.rotationSet?.nodes ?? nodesAsRows(enadata.codes, nodePositionResult.nodes, dimensionNames)
  };

  return {
    ...enadata,
    lineWeights: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, enadata.codeColumns, lineWeightsMatrix),
    pointsForProjection: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, enadata.codeColumns, pointsForProjection),
    points: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, dimensionNames, pointsMatrix),
    rotation,
    variance,
    centroids: centroidsAsRows(enadata.unitLabels, nodePositionResult.centroids, dimensionNames)
  };
}

export function projectIn(enadata: ENAData, by: RotationSet | ENASet, options: Omit<MakeSetOptions, 'rotationSet'> = {}): ENASet {
  const rotationSet = 'rotation' in by ? by.rotation : by;
  return makeSet(enadata, { ...options, rotationSet });
}
