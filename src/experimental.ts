// Experimental tier (advisory F-012): these APIs may change in any release.
// The elastic-net SOLVER is verified against glmnet at fixed lambdas (see
// NUMERICS.md), but its CV interface and the typed-array table helpers are
// still settling.
export {
  multiGaussianElasticNet,
  multiGaussianElasticNetCV
} from "./rotation/elasticNet.js";
export type {
  MultiGaussianElasticNetCVOptions,
  MultiGaussianElasticNetOptions,
  MultiGaussianElasticNetResult
} from "./rotation/elasticNet.js";
export { rowsToNumericTable, rowsToCoOccurrencesTyped } from "./performance.js";
export type { NumericTable } from "./performance.js";
