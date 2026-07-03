type Scalar = string | number | boolean | null;
type Row = Record<string, Scalar>;
type Matrix = number[][];
type ModelType = "EndPoint" | "AccumulatedTrajectory" | "SeparateTrajectory";
type WindowType = "MovingStanzaWindow" | "Conversation";
type WeightBy = "binary" | "sum" | ((values: number[]) => number);
type RotationMethod = "svd" | "mean" | "generalized" | "regression" | "regression2" | "hena" | "spherical";
type NodePositionMethod = "undirected" | "directed" | "directed-ground-response";
type GroupSelector = string[] | boolean[];
interface MeanRotationParams {
    groups: [GroupSelector, GroupSelector] | Array<[GroupSelector, GroupSelector]>;
}
interface GeneralizedRotationParams {
    xVar: string | string[];
    yVar?: string | string[];
    select2Groups?: [Scalar, Scalar];
}
interface RegressionRotationParams {
    xVar: string;
    yVar?: string;
    fullNames?: boolean;
}
interface HenaRotationParams {
    xVar: string;
    yVar?: string;
    controlVars?: string[];
    centering?: boolean;
    includeXY?: boolean;
    formula?: string;
}
interface SphericalRotationParams {
    anchor?: string | number[];
    secondaryAnchor?: string | number[];
}
interface RotationOptions {
    method: RotationMethod;
    params?: MeanRotationParams | GeneralizedRotationParams | RegressionRotationParams | HenaRotationParams | SphericalRotationParams;
}
interface AccumulateOptions {
    rows: Row[];
    units: string[];
    conversation: string[];
    codes: string[];
    metadata?: string[];
    model?: ModelType;
    weightBy?: WeightBy;
    window?: WindowType;
    windowSizeBack?: number;
    windowSizeForward?: number;
    mask?: Matrix;
    includeMeta?: boolean;
    unitsUsed?: string[];
}
interface AdjacencyKeyEntry {
    source: string;
    target: string;
    name: string;
    sourceIndex: number;
    targetIndex: number;
}
interface ENAData {
    modelType: ModelType;
    codes: string[];
    units: string[];
    conversation: string[];
    codeColumns: string[];
    adjacencyKey: AdjacencyKeyEntry[];
    rawRows: Row[];
    rowConnectionCounts: Row[];
    connectionCounts: Row[];
    connectionMatrix: Matrix;
    metaData: Row[];
    unitLabels: string[];
    trajectories?: Row[];
    functionParams: Required<Pick<AccumulateOptions, "model" | "weightBy" | "window" | "includeMeta">> & {
        windowSizeBack: number;
        windowSizeForward: number;
        unitsUsed?: string[];
    };
}
interface RotationSet {
    codes: string[];
    adjacencyKey: AdjacencyKeyEntry[];
    rotationMatrix: Matrix;
    rotationColumns: string[];
    eigenvalues: number[];
    centerVector: number[];
    nodes?: Row[];
}
interface ENASet extends ENAData {
    lineWeights: Row[];
    pointsForProjection: Row[];
    points: Row[];
    rotation: RotationSet;
    variance: Record<string, number>;
    centroids?: Row[];
}
interface MakeSetOptions {
    dimensions?: number;
    centerAlignToOrigin?: boolean;
    rotation?: RotationOptions;
    rotationSet?: RotationSet;
    nodePositionMethod?: NodePositionMethod;
}

export type { AccumulateOptions as A, ENASet as E, GeneralizedRotationParams as G, HenaRotationParams as H, MakeSetOptions as M, NodePositionMethod as N, RotationSet as R, Scalar as S, WeightBy as W, ENAData as a, Row as b, Matrix as c, MeanRotationParams as d, RegressionRotationParams as e, AdjacencyKeyEntry as f, GroupSelector as g, ModelType as h, RotationMethod as i, RotationOptions as j, SphericalRotationParams as k, WindowType as l };
