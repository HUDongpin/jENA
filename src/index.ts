// Stable public surface (advisory F-012 API tiering). Everything exported
// here is golden- or property-verified and semver-guarded. Deeper layers
// live behind subpaths:
//   jena-js/rotation     — rotation functions + node-position solvers
//   jena-js/plot         — plot model, plotly adapter, SVG renderer
//   jena-js/browser      — worker client (jena-js/browser/worker: the worker)
//   jena-js/core         — numerical kernels (internal tier, no semver guarantees)
//   jena-js/experimental — APIs that may change in any release
export * from "./types.js";
export { accumulateData, refWindowLag } from "./accumulate.js";
export { ena, extractMakeSetOptions } from "./ena.js";
export type { ENAOptions } from "./ena.js";
export { makeSet, projectIn } from "./model.js";
export {
  accumulateDataChunked,
  accumulateDataStreaming,
  createAccumulationStream,
  expandOrderedPriorRowIndices
} from "./performance.js";
export type {
  AccumulationChunkState,
  AccumulationStream,
  ChunkedAccumulateOptions,
  StreamingAccumulateOptions,
  StreamingMaterialization
} from "./performance.js";
// Accumulation-semantic kernels (verified against rENA's C++ core).
export {
  adjacencyKey,
  meanColumns,
  orderedAdjacencyKey,
  refWindowMatrix,
  rowsToCoOccurrences,
  skipSphereNorm,
  sphereNorm,
  stringVectorToUpperTriangle,
  sumColumns,
  vectorToUpperTriangle
} from "./core/matrix.js";
export { validateENADataNetworkContract } from "./core/validate.js";
export {
  cohensD,
  dimensionSummary,
  enaCorrelations,
  enaStats,
  groupSummary,
  inverseNormal
} from "./stats.js";
export type {
  DimensionCorrelation,
  DimensionSummaryRow,
  ENAStatsOptions,
  ENAStatsResult,
  GroupSummaryRow,
  StatTestRow
} from "./stats.js";
