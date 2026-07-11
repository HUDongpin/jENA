export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export type Matrix = number[][];

export type ModelType = "EndPoint" | "AccumulatedTrajectory" | "SeparateTrajectory";
export type WindowType = "MovingStanzaWindow" | "Conversation";
export type WeightBy = "binary" | "sum" | ((values: number[]) => number);

export type RotationMethod = "svd" | "mean" | "generalized" | "regression" | "regression2" | "hena" | "spherical";
export type NodePositionMethod = "undirected" | "directed" | "directed-ground-response";
export type GroupSelector = string[] | boolean[];

export interface MeanRotationParams {
  groups: [GroupSelector, GroupSelector] | Array<[GroupSelector, GroupSelector]>;
}

export interface GeneralizedRotationParams {
  xVar: string | string[];
  yVar?: string | string[];
  select2Groups?: [Scalar, Scalar];
}

export interface RegressionRotationParams {
  xVar: string;
  yVar?: string;
  fullNames?: boolean;
}

export interface HenaRotationParams {
  xVar: string;
  yVar?: string;
  controlVars?: string[];
  centering?: boolean;
  includeXY?: boolean;
  formula?: string;
}

export interface SphericalRotationParams {
  anchor?: string | number[];
  secondaryAnchor?: string | number[];
}

export interface RotationOptions {
  method: RotationMethod;
  params?: MeanRotationParams | GeneralizedRotationParams | RegressionRotationParams | HenaRotationParams | SphericalRotationParams;
}

export interface AccumulateOptions {
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

export interface AdjacencyKeyEntry {
  source: string;
  target: string;
  name: string;
  sourceIndex: number;
  targetIndex: number;
}

export interface ENAData {
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

export interface RotationSet {
  codes: string[];
  adjacencyKey: AdjacencyKeyEntry[];
  /**
   * Full rotation matrix over all rotated dimensions, matching rENA's
   * rotation sets. Display output (`points`, `nodes`) is truncated to
   * `MakeSetOptions.dimensions`, but projection and variance always use the
   * full matrix.
   */
  rotationMatrix: Matrix;
  /** Names for every column of `rotationMatrix` (e.g. SVD1..SVDn, MR1). */
  rotationColumns: string[];
  eigenvalues: number[];
  centerVector: number[];
  nodes?: Row[];
}

export interface ENASet extends ENAData {
  lineWeights: Row[];
  pointsForProjection: Row[];
  points: Row[];
  rotation: RotationSet;
  /**
   * Share of variance explained per rotated dimension, keyed by rotation
   * column name and normalized across ALL rotated dimensions (rENA
   * semantics), so the values do not sum to 1 over just the displayed
   * dimensions.
   */
  variance: Record<string, number>;
  centroids?: Row[];
}

export interface MakeSetOptions {
  dimensions?: number;
  centerAlignToOrigin?: boolean;
  rotation?: RotationOptions;
  rotationSet?: RotationSet;
  nodePositionMethod?: NodePositionMethod;
}
