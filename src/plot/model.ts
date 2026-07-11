import type { ENASet, Row, Scalar } from '../types.js';
import { networkFromConnectionRow, type NetworkGraph } from './network.js';

export type ENAPlotTraceType = 'points' | 'group' | 'network' | 'nodes' | 'trajectory';
export type ENAPlotSelector = Partial<Record<string, Scalar>> | ((row: Row) => boolean);

export interface ENAPlotPoint {
  x: number;
  y: number;
  label?: string;
  row?: Row;
}

export interface ENAPlotTrace {
  type: ENAPlotTraceType;
  name: string;
  color: string;
  points?: ENAPlotPoint[];
  network?: NetworkGraph;
}

export interface ENAPlotModel {
  title: string;
  dimensions: [string, string];
  axes: {
    x: { title: string; range: [number, number] };
    y: { title: string; range: [number, number] };
  };
  palette: string[];
  traces: ENAPlotTrace[];
}

export interface ENAPlotOptions {
  title?: string;
  dimensions?: [string, string];
  scaleTo?: 'network' | 'points' | number | { x?: [number, number]; y?: [number, number] };
  axisPadding?: number;
  palette?: string[];
}

export interface ENAPlotlyTrace {
  type: 'scatter';
  mode: string;
  name: string;
  x: number[];
  y: number[];
  text?: Array<string | undefined>;
  marker?: { color: string };
  line?: { color: string; width?: number };
}

const defaultPalette = ['#3366cc', '#dc3912', '#ff9900', '#109618', '#990099', '#0099c6', '#dd4477', '#66aa00'];

function dimensionPair(set: ENASet, dimensions?: [string, string]): [string, string] {
  return dimensions ?? [set.rotation.rotationColumns[0] ?? 'SVD1', set.rotation.rotationColumns[1] ?? 'SVD2'];
}

function numeric(row: Row, column: string): number {
  const value = Number(row[column] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function pointsFromRows(rows: Row[], dimensions: [string, string]): ENAPlotPoint[] {
  return rows.map((row) => ({ x: numeric(row, dimensions[0]), y: numeric(row, dimensions[1]), label: String(row.ENA_UNIT ?? row.unit ?? row.code ?? ''), row }));
}

function rangeFromValues(values: number[], padding: number): [number, number] {
  const max = Math.max(1e-9, ...values.map((value) => Math.abs(value))) * padding;
  return [-max, max];
}

function defaultAxisRange(set: ENASet, dimensions: [string, string], options: ENAPlotOptions): { x: [number, number]; y: [number, number] } {
  const padding = options.axisPadding ?? 1.2;
  if (typeof options.scaleTo === 'number') return { x: [-options.scaleTo, options.scaleTo], y: [-options.scaleTo, options.scaleTo] };
  if (typeof options.scaleTo === 'object') {
    const fallback = defaultAxisRange(set, dimensions, { ...options, scaleTo: 'network' });
    return { x: options.scaleTo.x ?? fallback.x, y: options.scaleTo.y ?? fallback.y };
  }
  const source = options.scaleTo === 'points' ? set.points : (set.rotation.nodes ?? set.points);
  return {
    x: rangeFromValues(source.map((row) => numeric(row, dimensions[0])), padding),
    y: rangeFromValues(source.map((row) => numeric(row, dimensions[1])), padding)
  };
}

function matchesSelector(row: Row, selector?: ENAPlotSelector): boolean {
  if (!selector) return true;
  if (typeof selector === 'function') return selector(row);
  return Object.entries(selector).every(([key, value]) => row[key] === value);
}

function nextColor(model: ENAPlotModel, explicit?: string): string {
  return explicit ?? model.palette[model.traces.length % model.palette.length] ?? '#3366cc';
}

function isNetworkGraph(value: Row | NetworkGraph | undefined): value is NetworkGraph {
  return Boolean(value && Array.isArray((value as NetworkGraph).nodes) && Array.isArray((value as NetworkGraph).edges));
}

function networkWithNodePositions(network: NetworkGraph, set: ENASet, dimensions: [string, string]): NetworkGraph {
  const positions = new Map((set.rotation.nodes ?? []).map((row) => [
    String(row.code ?? row.id ?? row.label ?? ''),
    { x: numeric(row, dimensions[0]), y: numeric(row, dimensions[1]) }
  ]));
  return {
    nodes: network.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, ...position } : node;
    }),
    edges: network.edges
  };
}

export function createENAPlotModel(set: ENASet, options: ENAPlotOptions = {}): ENAPlotModel {
  const dimensions = dimensionPair(set, options.dimensions);
  const axes = defaultAxisRange(set, dimensions, options);
  return {
    title: options.title ?? 'ENA Plot',
    dimensions,
    axes: {
      x: { title: dimensions[0], range: axes.x },
      y: { title: dimensions[1], range: axes.y }
    },
    palette: options.palette ?? defaultPalette,
    traces: []
  };
}

export function addPoints(model: ENAPlotModel, set: ENASet, selector?: ENAPlotSelector, options: { name?: string; color?: string } = {}): ENAPlotModel {
  model.traces.push({
    type: 'points',
    name: options.name ?? 'Points',
    color: nextColor(model, options.color),
    points: pointsFromRows(set.points.filter((row) => matchesSelector(row, selector)), model.dimensions)
  });
  return model;
}

export function addGroup(model: ENAPlotModel, set: ENASet, selector?: ENAPlotSelector, options: { name?: string; color?: string } = {}): ENAPlotModel {
  const points = pointsFromRows(set.points.filter((row) => matchesSelector(row, selector)), model.dimensions);
  const mean = points.length === 0
    ? []
    : [{
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
        label: options.name ?? 'Mean'
      }];
  model.traces.push({ type: 'group', name: options.name ?? 'Mean', color: nextColor(model, options.color), points: mean });
  return model;
}

export function addNetwork(model: ENAPlotModel, set: ENASet, rowOrNetwork?: Row | NetworkGraph, options: { name?: string; color?: string; minWeight?: number } = {}): ENAPlotModel {
  const network = isNetworkGraph(rowOrNetwork)
    ? rowOrNetwork
    : networkFromConnectionRow(rowOrNetwork ?? set.lineWeights[0] ?? {}, set.codes, set.adjacencyKey, options.minWeight ?? 0);
  model.traces.push({ type: 'network', name: options.name ?? 'Network', color: nextColor(model, options.color), network: networkWithNodePositions(network, set, model.dimensions) });
  return model;
}

export function addNodes(model: ENAPlotModel, set: ENASet, options: { name?: string; color?: string } = {}): ENAPlotModel {
  model.traces.push({
    type: 'nodes',
    name: options.name ?? 'Nodes',
    color: nextColor(model, options.color),
    points: pointsFromRows(set.rotation.nodes ?? [], model.dimensions)
  });
  return model;
}

export function addTrajectory(model: ENAPlotModel, set: ENASet, selector?: ENAPlotSelector, options: { name?: string; color?: string } = {}): ENAPlotModel {
  model.traces.push({
    type: 'trajectory',
    name: options.name ?? 'Trajectory',
    color: nextColor(model, options.color),
    points: pointsFromRows(set.points.filter((row) => matchesSelector(row, selector)), model.dimensions)
  });
  return model;
}

export function scalePlot(model: ENAPlotModel, scaleTo: number | { x?: [number, number]; y?: [number, number] }): ENAPlotModel {
  if (typeof scaleTo === 'number') {
    model.axes.x.range = [-scaleTo, scaleTo];
    model.axes.y.range = [-scaleTo, scaleTo];
  } else {
    if (scaleTo.x) model.axes.x.range = scaleTo.x;
    if (scaleTo.y) model.axes.y.range = scaleTo.y;
  }
  return model;
}

export function toPlotly(model: ENAPlotModel): { data: ENAPlotlyTrace[]; layout: Record<string, unknown> } {
  const data: ENAPlotlyTrace[] = model.traces.flatMap((trace): ENAPlotlyTrace[] => {
    if (trace.network) {
      const nodeById = new Map(trace.network.nodes.map((node) => [node.id, node]));
      return trace.network.edges.map((edge) => ({
        type: 'scatter',
        mode: 'lines',
        name: `${trace.name}: ${edge.name}`,
        line: { color: trace.color, width: Math.max(1, Math.abs(edge.weight) * 4) },
        x: [nodeById.get(edge.source)?.x ?? 0, nodeById.get(edge.target)?.x ?? 0],
        y: [nodeById.get(edge.source)?.y ?? 0, nodeById.get(edge.target)?.y ?? 0]
      }));
    }
    return [{
      type: 'scatter',
      mode: trace.type === 'trajectory' ? 'lines+markers' : 'markers',
      name: trace.name,
      marker: { color: trace.color },
      line: { color: trace.color },
      x: (trace.points ?? []).map((point) => point.x),
      y: (trace.points ?? []).map((point) => point.y),
      text: (trace.points ?? []).map((point) => point.label)
    }];
  });
  return {
    data,
    layout: {
      title: model.title,
      xaxis: { title: model.axes.x.title, range: model.axes.x.range },
      yaxis: { title: model.axes.y.title, range: model.axes.y.range }
    }
  };
}
