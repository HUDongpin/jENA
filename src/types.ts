export type Scalar = string | number | boolean | null;
export type Row = Record<string, Scalar>;
export type Matrix = number[][];

export type ModelType = "EndPoint" | "AccumulatedTrajectory" | "SeparateTrajectory";
export type WindowType = "MovingStanzaWindow" | "Conversation";
export type NetworkType = "standard" | "ordered";
/**
 * Weighting applied to each windowed co-occurrence cell BEFORE unit
 * accumulation. "binary" thresholds each window's cell to 0/1; "sum" keeps
 * the raw window products (rENA passes R's `sum`, which is the identity on
 * its length-1 input). A function is called once per cell with a
 * single-element array `[value]` and returns the transformed value —
 * matching rENA's runtime behavior exactly (golden-verified; note rENA's own
 * docstring says "after accumulation", but its implementation groups by row,
 * so the function sees one window cell at a time). Functions cannot cross
 * the worker boundary; the worker API restricts this to the string forms.
 */
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
}

export interface SphericalRotationParams {
  anchor?: string | number[];
  secondaryAnchor?: string | number[];
}

/**
 * Discriminated by `method`, so each rotation's parameter shape is enforced
 * at compile time (advisory F-012).
 */
export type RotationOptions =
  | { method: 'svd' }
  | { method: 'mean'; params: MeanRotationParams }
  | { method: 'generalized'; params: GeneralizedRotationParams }
  | { method: 'regression'; params: RegressionRotationParams }
  | { method: 'regression2'; params: RegressionRotationParams }
  | { method: 'hena'; params: HenaRotationParams }
  | { method: 'spherical'; params?: SphericalRotationParams };

export interface AccumulateOptions {
  rows: Row[];
  units: string[];
  conversation: string[];
  codes: string[];
  metadata?: string[];
  networkType?: NetworkType;
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

export interface OrderedWindowProvenance {
  /** Zero-based input row receiving the ordered connection contribution. */
  responseRowIndex: number;
  /** Merged conversation-column value defining the response row's horizon. */
  horizon: string;
  /** Previous response row in the same typed horizon, or null at its boundary. */
  previousRowIndex: number | null;
  /** Number of predecessor rows actually included in this response's window. */
  priorRowCount: number;
}

export interface ENAData {
  /** Omitted for legacy standard results; absence means the default "standard" network. */
  networkType?: NetworkType;
  modelType: ModelType;
  codes: string[];
  units: string[];
  conversation: string[];
  codeColumns: string[];
  adjacencyKey: AdjacencyKeyEntry[];
  rawRows: Row[];
  rowConnectionCounts: Row[];
  /** Ordered-only window provenance; retained even for model-only materialization. */
  rowWindowProvenance?: OrderedWindowProvenance[];
  connectionCounts: Row[];
  connectionMatrix: Matrix;
  metaData: Row[];
  unitLabels: string[];
  trajectories?: Row[];
  functionParams: Required<Pick<AccumulateOptions, "model" | "weightBy" | "window" | "includeMeta">> & {
    networkType?: NetworkType;
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
