import { b as Row, f as AdjacencyKeyEntry, S as Scalar, E as ENASet } from '../types-D1hkFDIv.js';

interface NetworkNode {
    id: string;
    label: string;
    x?: number;
    y?: number;
}
interface NetworkEdge {
    source: string;
    target: string;
    weight: number;
    name: string;
}
interface NetworkGraph {
    nodes: NetworkNode[];
    edges: NetworkEdge[];
}
declare function networkFromConnectionRow(row: Row, codes: string[], adjacencyKey: AdjacencyKeyEntry[], minWeight?: number): NetworkGraph;

type ENAPlotTraceType = 'points' | 'group' | 'network' | 'nodes' | 'trajectory';
type ENAPlotSelector = Partial<Record<string, Scalar>> | ((row: Row) => boolean);
interface ENAPlotPoint {
    x: number;
    y: number;
    label?: string;
    row?: Row;
}
interface ENAPlotTrace {
    type: ENAPlotTraceType;
    name: string;
    color: string;
    points?: ENAPlotPoint[];
    network?: NetworkGraph;
}
interface ENAPlotModel {
    title: string;
    dimensions: [string, string];
    axes: {
        x: {
            title: string;
            range: [number, number];
        };
        y: {
            title: string;
            range: [number, number];
        };
    };
    palette: string[];
    traces: ENAPlotTrace[];
}
interface ENAPlotOptions {
    title?: string;
    dimensions?: [string, string];
    scaleTo?: 'network' | 'points' | number | {
        x?: [number, number];
        y?: [number, number];
    };
    axisPadding?: number;
    palette?: string[];
}
interface ENAPlotlyTrace {
    type: 'scatter';
    mode: string;
    name: string;
    x: number[];
    y: number[];
    text?: Array<string | undefined>;
    marker?: {
        color: string;
    };
    line?: {
        color: string;
        width?: number;
    };
}
declare function createENAPlotModel(set: ENASet, options?: ENAPlotOptions): ENAPlotModel;
declare function addPoints(model: ENAPlotModel, set: ENASet, selector?: ENAPlotSelector, options?: {
    name?: string;
    color?: string;
}): ENAPlotModel;
declare function addGroup(model: ENAPlotModel, set: ENASet, selector?: ENAPlotSelector, options?: {
    name?: string;
    color?: string;
}): ENAPlotModel;
declare function addNetwork(model: ENAPlotModel, set: ENASet, rowOrNetwork?: Row | NetworkGraph, options?: {
    name?: string;
    color?: string;
    minWeight?: number;
}): ENAPlotModel;
declare function addNodes(model: ENAPlotModel, set: ENASet, options?: {
    name?: string;
    color?: string;
}): ENAPlotModel;
declare function addTrajectory(model: ENAPlotModel, set: ENASet, selector?: ENAPlotSelector, options?: {
    name?: string;
    color?: string;
}): ENAPlotModel;
declare function scalePlot(model: ENAPlotModel, scaleTo: number | {
    x?: [number, number];
    y?: [number, number];
}): ENAPlotModel;
declare function toPlotly(model: ENAPlotModel): {
    data: ENAPlotlyTrace[];
    layout: Record<string, unknown>;
};

interface ENAPlotRendererOptions {
    width?: number;
    height?: number;
    clear?: boolean;
    background?: string;
    showLabels?: boolean;
}
interface ENAPlotRenderer {
    element: SVGSVGElement;
    update(model: ENAPlotModel): void;
    destroy(): void;
}
declare function renderENAPlot(container: Element, model: ENAPlotModel, rendererOptions?: ENAPlotRendererOptions): ENAPlotRenderer;

export { type ENAPlotModel, type ENAPlotOptions, type ENAPlotPoint, type ENAPlotRenderer, type ENAPlotRendererOptions, type ENAPlotSelector, type ENAPlotTrace, type ENAPlotTraceType, type ENAPlotlyTrace, type NetworkEdge, type NetworkGraph, type NetworkNode, addGroup, addNetwork, addNodes, addPoints, addTrajectory, createENAPlotModel, networkFromConnectionRow, renderENAPlot, scalePlot, toPlotly };
