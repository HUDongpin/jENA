import type { AdjacencyKeyEntry, Row } from '../types.js';

export interface NetworkNode {
  id: string;
  label: string;
  x?: number;
  y?: number;
}

export interface NetworkEdge {
  source: string;
  target: string;
  weight: number;
  name: string;
}

export interface NetworkGraph {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export function networkFromConnectionRow(row: Row, codes: string[], adjacencyKey: AdjacencyKeyEntry[], minWeight = 0): NetworkGraph {
  const nodes = codes.map((code) => ({ id: code, label: code }));
  const edges = adjacencyKey
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      name: edge.name,
      weight: Number(row[edge.name] ?? 0)
    }))
    .filter((edge) => Math.abs(edge.weight) > minWeight);
  return { nodes, edges };
}
