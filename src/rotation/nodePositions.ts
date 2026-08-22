/*
 * Derived from rENA 0.3.1 (GPL-3), (c) the rENA authors: Cody L Marquart,
 * Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and
 * David Williamson Shaffer. This file ports lws_lsq_positions from src/ena.cpp
 * and R/lws.positions.sq.R.
 * TypeScript translation and modifications for jena-js, GPL-3.0-only.
 * See PROVENANCE.md for the upstream NOTICE and version pin.
 */
import type { Matrix, Row } from '../types.js';
import { multiplyMatrices, transpose } from '../core/matrix.js';
import { solveLinearSystem } from '../core/linear.js';

function nodeWeightsFromLineWeights(lineWeights: Matrix, numNodes: number): Matrix {
  return lineWeights.map((adjacency) => {
    const weights = Array.from({ length: numNodes }, () => 0);
    let z = 0;
    for (let x = 0; x < numNodes - 1; x += 1) {
      for (let y = 0; y <= x; y += 1) {
        const value = adjacency[z] ?? 0;
        weights[x + 1] = (weights[x + 1] ?? 0) + 0.5 * value;
        weights[y] = (weights[y] ?? 0) + 0.5 * value;
        z += 1;
      }
    }
    const length = Math.max(0.0001, weights.reduce((sum, value) => sum + Math.abs(value), 0));
    return weights.map((value) => value / length);
  });
}

function directedWeightsFromLineWeights(lineWeights: Matrix, numNodes: number): Matrix {
  return lineWeights.map((adjacency) => {
    const weights = Array.from({ length: numNodes }, () => 0);
    let z = 0;
    for (let x = 0; x < numNodes; x += 1) {
      for (let y = 0; y < numNodes; y += 1) {
        const value = adjacency[z] ?? 0;
        weights[x] = (weights[x] ?? 0) + value;
        // A self edge is incident to one endpoint, not two. Non-self directed
        // edges contribute once to their ground and response endpoints.
        if (x !== y) weights[y] = (weights[y] ?? 0) + value;
        z += 1;
      }
    }
    const length = Math.max(0.0001, weights.reduce((sum, value) => sum + Math.abs(value), 0));
    return weights.map((value) => value / length);
  });
}

function solveNodePositionsFromWeights(weights: Matrix, points: Matrix): NodePositionResult {
  const wt = transpose(weights);
  const normal = multiplyMatrices(wt, weights);
  const dims = points[0]?.length ?? 0;
  const nodeCount = weights[0]?.length ?? 0;
  const nodeColumns: Matrix = [];

  for (let dim = 0; dim < dims; dim += 1) {
    const rhs = multiplyMatrices(wt, points.map((row) => [row[dim] ?? 0])).map((row) => row[0] ?? 0);
    nodeColumns.push(solveLinearSystem(normal, rhs));
  }

  const nodes = Array.from({ length: nodeCount }, (_unused, nodeIndex) => nodeColumns.map((col) => col[nodeIndex] ?? 0));
  return { nodes, centroids: multiplyMatrices(weights, nodes), weights };
}

export interface NodePositionResult {
  nodes: Matrix;
  centroids: Matrix;
  weights: Matrix;
}

export function lwsLeastSquaresPositions(lineWeights: Matrix, points: Matrix, numNodes: number): NodePositionResult {
  if (lineWeights.length !== points.length) {
    throw new Error('lineWeights and points must have the same number of rows.');
  }
  if (points.length === 0) return { nodes: [], centroids: [], weights: [] };

  const weights = nodeWeightsFromLineWeights(lineWeights, numNodes);
  return solveNodePositionsFromWeights(weights, points);
}

function directedNodeCount(adjacencyLength: number, method: string): number {
  const numNodes = Math.round(Math.sqrt(adjacencyLength));
  if (numNodes * numNodes !== adjacencyLength) {
    throw new Error(
      `${method} requires a directed adjacency with n*n columns per row, got ${adjacencyLength}. ` +
      'Undirected models produce n*(n-1)/2 upper-triangle columns; use nodePositionMethod: "undirected" for them.'
    );
  }
  return numNodes;
}

function validateDirectedAdjacencyShape(lineWeights: Matrix, method: string): number {
  const firstRow = lineWeights[0];
  if (!Array.isArray(firstRow)) {
    throw new Error(`${method} lineWeights row 0 must be an array.`);
  }
  const adjacencyLength = firstRow.length;
  const numNodes = directedNodeCount(adjacencyLength, method);
  for (let rowIndex = 0; rowIndex < lineWeights.length; rowIndex += 1) {
    const row = lineWeights[rowIndex];
    if (!Array.isArray(row) || row.length !== adjacencyLength) {
      throw new Error(
        `${method} lineWeights row ${rowIndex} must contain ${adjacencyLength} directed adjacency cells matching row 0; ` +
        `got ${Array.isArray(row) ? row.length : typeof row}.`
      );
    }
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = row[columnIndex];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `${method} lineWeights[${rowIndex}][${columnIndex}] must be a finite number; got ${String(value)}.`
        );
      }
    }
  }
  return numNodes;
}

function validateDirectedPoints(points: Matrix, method: string): void {
  const firstRow = points[0];
  if (!Array.isArray(firstRow)) {
    throw new Error(`${method} points row 0 must be an array.`);
  }
  const dimensions = firstRow.length;
  for (let rowIndex = 0; rowIndex < points.length; rowIndex += 1) {
    const row = points[rowIndex];
    if (!Array.isArray(row) || row.length !== dimensions) {
      throw new Error(
        `${method} points row ${rowIndex} must contain ${dimensions} dimensions matching row 0; ` +
        `got ${Array.isArray(row) ? row.length : typeof row}.`
      );
    }
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const value = row[columnIndex];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `${method} points[${rowIndex}][${columnIndex}] must be a finite number; got ${String(value)}.`
        );
      }
    }
  }
}

export function directedNodePositions(lineWeights: Matrix, points: Matrix): NodePositionResult {
  if (lineWeights.length !== points.length) {
    throw new Error('lineWeights and points must have the same number of rows.');
  }
  if (points.length === 0) return { nodes: [], centroids: [], weights: [] };
  const numNodes = validateDirectedAdjacencyShape(lineWeights, 'directedNodePositions');
  validateDirectedPoints(points, 'directedNodePositions');
  return solveNodePositionsFromWeights(directedWeightsFromLineWeights(lineWeights, numNodes), points);
}

export function directedNodePositionsWithGroundResponseAdded(lineWeights: Matrix, points: Matrix): NodePositionResult {
  if (lineWeights.length !== points.length) {
    throw new Error('lineWeights and points must have the same number of rows.');
  }
  if (lineWeights.length % 2 !== 0) {
    throw new Error(
      'directedNodePositionsWithGroundResponseAdded requires an even number of paired ground/response rows; ' +
      `got ${lineWeights.length}.`
    );
  }
  if (points.length === 0) return { nodes: [], centroids: [], weights: [] };
  const numNodes = validateDirectedAdjacencyShape(lineWeights, 'directedNodePositionsWithGroundResponseAdded');
  validateDirectedPoints(points, 'directedNodePositionsWithGroundResponseAdded');
  const weights = directedWeightsFromLineWeights(lineWeights, numNodes);
  const addedWeights: Matrix = [];
  const addedPoints: Matrix = [];
  for (let row = 0; row + 1 < weights.length; row += 2) {
    addedWeights.push(Array.from({ length: numNodes }, (_unused, col) => (weights[row]?.[col] ?? 0) + (weights[row + 1]?.[col] ?? 0)));
    const dims = points[0]?.length ?? 0;
    addedPoints.push(Array.from({ length: dims }, (_unused, col) => (points[row]?.[col] ?? 0) + (points[row + 1]?.[col] ?? 0)));
  }
  const solved = solveNodePositionsFromWeights(addedWeights, addedPoints);
  return { nodes: solved.nodes, centroids: multiplyMatrices(weights, solved.nodes), weights };
}

export function nodesAsRows(codes: string[], nodeMatrix: Matrix, dimensions: string[]): Row[] {
  return nodeMatrix.map((row, index) => ({
    code: codes[index] ?? String(index),
    ...Object.fromEntries(dimensions.map((dimension, dimIndex) => [dimension, row[dimIndex] ?? 0]))
  }));
}

export function centroidsAsRows(unitLabels: string[], centroidMatrix: Matrix, dimensions: string[]): Row[] {
  return centroidMatrix.map((row, index) => ({
    unit: unitLabels[index] ?? String(index),
    ...Object.fromEntries(dimensions.map((dimension, dimIndex) => [dimension, row[dimIndex] ?? 0]))
  }));
}
