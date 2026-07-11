import type {
  ENAData,
  ENASet,
  GeneralizedRotationParams,
  HenaRotationParams,
  MakeSetOptions,
  Matrix,
  MeanRotationParams,
  RegressionRotationParams,
  Row,
  RotationOptions,
  RotationSet,
  SphericalRotationParams
} from './types.js';
import { centerData, meanColumns, multiplyMatrices, sphereNorm, varianceColumns } from './core/matrix.js';
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

function meanParams(options: RotationOptions | undefined): MeanRotationParams {
  const params = options?.params;
  if (!params || !('groups' in params)) throw new Error('Mean rotation requires rotation.params.groups.');
  return params;
}

function generalizedParams(options: RotationOptions | undefined): GeneralizedRotationParams {
  const params = options?.params;
  if (!params || !('xVar' in params)) throw new Error('Generalized rotation requires rotation.params.xVar.');
  return params;
}

function regressionParams(options: RotationOptions | undefined): RegressionRotationParams {
  const params = options?.params as RegressionRotationParams | undefined;
  if (!params || typeof params.xVar !== 'string') throw new Error('Regression rotation requires rotation.params.xVar.');
  return params;
}

function henaParams(options: RotationOptions | undefined): HenaRotationParams {
  const params = options?.params as HenaRotationParams | undefined;
  if (!params || typeof params.xVar !== 'string') throw new Error('HENA rotation requires rotation.params.xVar.');
  return params;
}

function sphericalParams(options: RotationOptions | undefined): SphericalRotationParams {
  return (options?.params ?? {}) as SphericalRotationParams;
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

  const rotation = options.rotation;
  switch (rotation?.method ?? 'svd') {
    case 'svd':
      return svdRotation(pointsForProjection);
    case 'mean':
      return rotateByMean(pointsForProjection, enadata, meanParams(rotation));
    case 'generalized':
      return rotateByGeneralized(pointsForProjection, enadata, generalizedParams(rotation));
    case 'regression':
      return rotateByRegression(pointsForProjection, enadata, regressionParams(rotation));
    case 'regression2':
      return rotateByRegression2(pointsForProjection, enadata, regressionParams(rotation));
    case 'hena':
      return rotateByHena(pointsForProjection, enadata, henaParams(rotation));
    case 'spherical':
      return rotateBySpherical(pointsForProjection, enadata, sphericalParams(rotation));
  }
}

function makeNodePositions(lineWeights: Matrix, points: Matrix, codeCount: number, options: MakeSetOptions): NodePositionResult {
  switch (options.nodePositionMethod ?? 'undirected') {
    case 'undirected':
      return lwsLeastSquaresPositions(lineWeights, points, codeCount);
    case 'directed':
      return directedNodePositions(lineWeights, points);
    case 'directed-ground-response':
      return directedNodePositionsWithGroundResponseAdded(lineWeights, points);
  }
}

export function makeSet(enadata: ENAData, options: MakeSetOptions = {}): ENASet {
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
