import { A as AccumulateOptions, a as ENAData, M as MakeSetOptions, E as ENASet, R as RotationSet, b as Row, c as Matrix, G as GeneralizedRotationParams, H as HenaRotationParams, d as MeanRotationParams, e as RegressionRotationParams } from './types-D1hkFDIv.js';
export { f as AdjacencyKeyEntry, g as GroupSelector, h as ModelType, N as NodePositionMethod, i as RotationMethod, j as RotationOptions, S as Scalar, k as SphericalRotationParams, W as WeightBy, l as WindowType } from './types-D1hkFDIv.js';
export { E as ENAOptions, e as ena } from './worker-DbeQhbrj.js';
export { EigenResult, addMergedColumn, addVectors, adjacencyKey, assertFiniteNumbers, assertNonEmptyColumns, assertRectangularMatrix, assertRowsHaveColumns, centerData, cloneMatrix, combnC2, covarianceLike, designSolve, dot, gramSchmidtComplete, groupBy, identity, l2Norm, matrixAdd, matrixSubtract, meanColumns, mergeColumns, multiplyMatrices, multiplyMatrixVector, normalizeVector, numericRowFromColumns, outerProduct, pearsonCorrelation, refWindowLag, refWindowMatrix, rowsToCoOccurrences, rowsWithNumericColumns, scalarToString, scaleVector, selectColumns, skipSphereNorm, solveLinearSystem, sphereNorm, stringVectorToUpperTriangle, subtractOuterProjection, subtractVectors, sumColumns, sumRowsBy, symmetricJacobiEigen, toNumericMatrix, transpose, triIndices, uniqueRows, varianceColumns, vectorToUpperTriangle, zeros } from './core/index.js';
export { ENAPlotModel, ENAPlotOptions, ENAPlotPoint, ENAPlotRenderer, ENAPlotRendererOptions, ENAPlotSelector, ENAPlotTrace, ENAPlotTraceType, ENAPlotlyTrace, NetworkEdge, NetworkGraph, NetworkNode, addGroup, addNetwork, addNodes, addPoints, addTrajectory, createENAPlotModel, networkFromConnectionRow, renderENAPlot, scalePlot, toPlotly } from './plot/index.js';
export { ENAWorkerClient, ENAWorkerLike, ENAWorkerProgress, ENAWorkerRunHandle, createENAWorkerClient } from './browser/index.js';

declare function accumulateData(options: AccumulateOptions): ENAData;

declare function makeSet(enadata: ENAData, options?: MakeSetOptions): ENASet;
declare function projectIn(enadata: ENAData, by: RotationSet | ENASet, options?: Omit<MakeSetOptions, 'rotationSet'>): ENASet;

interface NumericTable {
    data: Float64Array;
    rows: number;
    cols: number;
}
type StreamingMaterialization = 'full' | 'model';
interface ChunkedAccumulateOptions extends AccumulateOptions {
    chunkSize?: number;
    onProgress?: (progress: number) => void;
    materialization?: StreamingMaterialization;
}
interface StreamingAccumulateOptions extends Omit<AccumulateOptions, 'rows'> {
    rows?: Row[];
    chunkSize?: number;
    expectedRows?: number;
    materialization?: StreamingMaterialization;
    onProgress?: (progress: number, state: AccumulationChunkState) => void;
}
interface AccumulationChunkState {
    rowsSeen: number;
    chunksSeen: number;
    isFinished: boolean;
    progress: number;
    activeConversations: number;
    activeBufferedRows: number;
    activeConversationsPeak: number;
    activeBufferedRowsPeak: number;
}
interface AccumulationStream {
    readonly state: AccumulationChunkState;
    push(rows: Row[]): AccumulationChunkState;
    finish(): ENAData;
    reset(): void;
}
declare function rowsToNumericTable(rows: Row[], columns: string[]): NumericTable;
declare function rowsToCoOccurrencesTyped(table: NumericTable, binary?: boolean): NumericTable;
declare function accumulateDataChunked(options: ChunkedAccumulateOptions): ENAData;
declare function createAccumulationStream(options: StreamingAccumulateOptions): AccumulationStream;
declare function accumulateDataStreaming(options: StreamingAccumulateOptions): ENAData;

interface SvdRotationResult {
    rotationMatrix: Matrix;
    rotationColumns: string[];
    eigenvalues: number[];
}
declare function svdRotation(pointsForProjection: Matrix): SvdRotationResult;

interface NodePositionResult {
    nodes: Matrix;
    centroids: Matrix;
    weights: Matrix;
}
declare function lwsLeastSquaresPositions(lineWeights: Matrix, points: Matrix, numNodes: number): NodePositionResult;
declare function directedNodePositions(lineWeights: Matrix, points: Matrix): NodePositionResult;
declare function directedNodePositionsWithGroundResponseAdded(lineWeights: Matrix, points: Matrix): NodePositionResult;
declare function nodesAsRows(codes: string[], nodeMatrix: Matrix, dimensions: string[]): Row[];
declare function centroidsAsRows(unitLabels: string[], centroidMatrix: Matrix, dimensions: string[]): Row[];

declare function rotateByMean(pointsForProjection: Matrix, enadata: ENAData, params: MeanRotationParams): SvdRotationResult;
declare function rotateByGeneralized(pointsForProjection: Matrix, enadata: ENAData, params: GeneralizedRotationParams): SvdRotationResult;
declare function rotateByRegression(pointsForProjection: Matrix, enadata: ENAData, params: RegressionRotationParams): SvdRotationResult;
declare function rotateByRegression2(pointsForProjection: Matrix, enadata: ENAData, params: RegressionRotationParams): SvdRotationResult;
declare function rotateByHena(pointsForProjection: Matrix, enadata: ENAData, params: HenaRotationParams): SvdRotationResult;
declare function rotateBySpherical(pointsForProjection: Matrix, enadata: ENAData, params?: {
    anchor?: string | number[];
    secondaryAnchor?: string | number[];
}): SvdRotationResult;
declare function projectRotation(pointsForProjection: Matrix, rotationMatrix: Matrix): Matrix;
declare function deflateMatrix(matrix: Matrix, vectors: number[][]): Matrix;
declare function residualMatrix(matrix: Matrix, fitted: Matrix): Matrix;

interface ElasticNetOptions {
    alpha?: number;
    lambda?: number;
    maxIterations?: number;
    tolerance?: number;
    penaltyFactor?: number[];
}
interface ElasticNetCVOptions extends ElasticNetOptions {
    lambdas?: number[];
    folds?: number;
}
interface ElasticNetResult {
    coefficients: Matrix;
    lambda: number;
}
declare function elasticNet(design: Matrix, response: Matrix, options?: ElasticNetOptions): ElasticNetResult;
declare function elasticNetCV(design: Matrix, response: Matrix, options?: ElasticNetCVOptions): ElasticNetResult;

interface DimensionCorrelation {
    dimension: string;
    pearson: number;
    spearman: number;
    pearsonLower: number;
    pearsonUpper: number;
}
interface GroupSummaryRow {
    group: string;
    n: number;
    means: Record<string, number>;
}
interface DimensionSummaryRow {
    dimension: string;
    n: number;
    mean: number;
    sd: number;
    variance: number;
    min: number;
    max: number;
}
interface StatTestRow {
    dimension: string;
    test: 'welch-t' | 'one-way-anova';
    groups: string[];
    statistic: number;
    df?: number;
    dfBetween?: number;
    dfWithin?: number;
}
interface ENAStatsOptions {
    dims?: Array<number | string>;
    by?: string;
    confLevel?: number;
}
interface ENAStatsResult {
    dimensions: DimensionSummaryRow[];
    correlations: DimensionCorrelation[];
    groups?: GroupSummaryRow[];
    tests?: StatTestRow[];
}
declare function enaCorrelations(set: ENASet, dims?: Array<number | string>, confLevel?: number): DimensionCorrelation[];
declare function cohensD(x: number[], y: number[]): number;
declare function dimensionSummary(set: ENASet, dims?: Array<number | string>): DimensionSummaryRow[];
declare function groupSummary(set: ENASet, by: string, dims?: Array<number | string>): GroupSummaryRow[];
declare function enaStats(set: ENASet, options?: ENAStatsOptions): ENAStatsResult;

export { AccumulateOptions, type AccumulationChunkState, type AccumulationStream, type ChunkedAccumulateOptions, type DimensionCorrelation, type DimensionSummaryRow, ENAData, ENASet, type ENAStatsOptions, type ENAStatsResult, type ElasticNetCVOptions, type ElasticNetOptions, type ElasticNetResult, GeneralizedRotationParams, type GroupSummaryRow, HenaRotationParams, MakeSetOptions, Matrix, MeanRotationParams, type NodePositionResult, type NumericTable, RegressionRotationParams, RotationSet, Row, type StatTestRow, type StreamingAccumulateOptions, type StreamingMaterialization, type SvdRotationResult, accumulateData, accumulateDataChunked, accumulateDataStreaming, centroidsAsRows, cohensD, createAccumulationStream, deflateMatrix, dimensionSummary, directedNodePositions, directedNodePositionsWithGroundResponseAdded, elasticNet, elasticNetCV, enaCorrelations, enaStats, groupSummary, lwsLeastSquaresPositions, makeSet, nodesAsRows, projectIn, projectRotation, residualMatrix, rotateByGeneralized, rotateByHena, rotateByMean, rotateByRegression, rotateByRegression2, rotateBySpherical, rowsToCoOccurrencesTyped, rowsToNumericTable, svdRotation };
