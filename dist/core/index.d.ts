import { c as Matrix, b as Row, f as AdjacencyKeyEntry, S as Scalar } from '../types-D1hkFDIv.js';

declare function assertNonEmptyColumns(columns: string[], label: string): void;
declare function assertRowsHaveColumns(rows: Row[], columns: string[], label?: string): void;
declare function assertRectangularMatrix(matrix: Matrix, label?: string): void;
declare function assertFiniteNumbers(matrix: Matrix, label?: string): void;

declare function cloneMatrix(matrix: Matrix): Matrix;
declare function zeros(rows: number, cols: number): Matrix;
declare function combnC2(n: number): Matrix;
declare function triIndices(length: number, row?: -1 | 0 | 1): Matrix;
declare function adjacencyKey(codes: string[]): AdjacencyKeyEntry[];
declare function vectorToUpperTriangle(vector: number[]): number[];
declare function stringVectorToUpperTriangle(values: string[]): string[];
declare function rowsToCoOccurrences(matrix: Matrix, binary?: boolean): Matrix;
declare function sumColumns(matrix: Matrix): number[];
declare function meanColumns(matrix: Matrix): number[];
declare function subtractVectors(a: number[], b: number[]): number[];
declare function addVectors(a: number[], b: number[]): number[];
declare function scaleVector(vector: number[], scalar: number): number[];
declare function dot(a: number[], b: number[]): number;
declare function l2Norm(vector: number[]): number;
declare function refWindowMatrix(matrix: Matrix, windowSize?: number, windowForward?: number, binary?: boolean): Matrix;
declare function refWindowLag(matrix: Matrix, windowSize?: number): Matrix;
declare function sphereNorm(matrix: Matrix): Matrix;
declare function skipSphereNorm(matrix: Matrix): Matrix;
declare function centerData(matrix: Matrix, centerVector?: number[]): Matrix;
declare function transpose(matrix: Matrix): Matrix;
declare function multiplyMatrices(a: Matrix, b: Matrix): Matrix;
declare function varianceColumns(matrix: Matrix): number[];
declare function pearsonCorrelation(a: number[], b: number[]): number;
declare function cohensD(x: number[], y: number[]): number;

declare function scalarToString(value: Scalar): string;
declare function mergeColumns(row: Row, columns: string[], separator?: string): string;
declare function addMergedColumn(rows: Row[], outputColumn: string, columns: string[], separator?: string): Row[];
declare function selectColumns(rows: Row[], columns: string[]): Row[];
declare function toNumericMatrix(rows: Row[], columns: string[]): Matrix;
declare function groupBy<RowType extends Row>(rows: RowType[], keyFn: (row: RowType) => string): Map<string, RowType[]>;
declare function uniqueRows(rows: Row[], keyColumns: string[]): Row[];
declare function numericRowFromColumns(row: Row, columns: string[]): number[];
declare function rowsWithNumericColumns(rows: Row[], columns: string[], matrix: Matrix): Row[];
declare function sumRowsBy(rows: Row[], keyColumns: string[], valueColumns: string[]): Row[];

declare function identity(n: number): Matrix;

interface EigenResult {
    eigenvalues: number[];
    eigenvectors: Matrix;
}
declare function solveLinearSystem(a: Matrix, b: number[], ridge?: number): number[];
declare function multiplyMatrixVector(matrix: Matrix, vector: number[]): number[];
declare function normalizeVector(vector: number[]): number[];
declare function outerProduct(a: number[], b: number[]): Matrix;
declare function subtractOuterProjection(matrix: Matrix, vector: number[]): Matrix;
declare function matrixSubtract(a: Matrix, b: Matrix): Matrix;
declare function matrixAdd(a: Matrix, b: Matrix): Matrix;
declare function gramSchmidtComplete(columns: Matrix, dimension: number, tolerance?: number): Matrix;
declare function designSolve(design: Matrix, response: Matrix, ridge?: number): Matrix;
declare function symmetricJacobiEigen(input: Matrix, maxIterations?: number, tolerance?: number): EigenResult;
declare function covarianceLike(matrix: Matrix): Matrix;

export { type EigenResult, addMergedColumn, addVectors, adjacencyKey, assertFiniteNumbers, assertNonEmptyColumns, assertRectangularMatrix, assertRowsHaveColumns, centerData, cloneMatrix, cohensD, combnC2, covarianceLike, designSolve, dot, gramSchmidtComplete, groupBy, identity, l2Norm, matrixAdd, matrixSubtract, meanColumns, mergeColumns, multiplyMatrices, multiplyMatrixVector, normalizeVector, numericRowFromColumns, outerProduct, pearsonCorrelation, refWindowLag, refWindowMatrix, rowsToCoOccurrences, rowsWithNumericColumns, scalarToString, scaleVector, selectColumns, skipSphereNorm, solveLinearSystem, sphereNorm, stringVectorToUpperTriangle, subtractOuterProjection, subtractVectors, sumColumns, sumRowsBy, symmetricJacobiEigen, toNumericMatrix, transpose, triIndices, uniqueRows, varianceColumns, vectorToUpperTriangle, zeros };
