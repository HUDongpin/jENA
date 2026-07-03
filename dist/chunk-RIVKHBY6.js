import {
  addMergedColumn,
  adjacencyKey,
  assertNonEmptyColumns,
  assertRowsHaveColumns,
  centerData,
  covarianceLike,
  designSolve,
  dot,
  gramSchmidtComplete,
  groupBy,
  l2Norm,
  matrixSubtract,
  meanColumns,
  mergeColumns,
  multiplyMatrices,
  normalizeVector,
  refWindowMatrix,
  rowsToCoOccurrences,
  solveLinearSystem,
  sphereNorm,
  stringVectorToUpperTriangle,
  subtractOuterProjection,
  subtractVectors,
  sumColumns,
  sumRowsBy,
  symmetricJacobiEigen,
  toNumericMatrix,
  transpose,
  varianceColumns,
  vectorToUpperTriangle
} from "./chunk-CS2S5LAI.js";

// src/accumulate.ts
function normalizeModel(model) {
  return model ?? "EndPoint";
}
function normalizeWindow(window) {
  return window ?? "MovingStanzaWindow";
}
function normalizeWeightBy(weightBy) {
  return weightBy ?? "binary";
}
function adjacencyColumnNames(count) {
  return Array.from({ length: count }, (_, index) => `adjacency.code.${index + 1}`);
}
function renameAdjacencyColumns(rows, fromColumns, toColumns) {
  return rows.map((row) => {
    const next = { ...row };
    for (let index = 0; index < fromColumns.length; index += 1) {
      const from = fromColumns[index];
      const to = toColumns[index];
      if (from && to) {
        next[to] = next[from] ?? 0;
        delete next[from];
      }
    }
    return next;
  });
}
function applyMask(matrix, mask) {
  if (!mask) return matrix;
  return matrix.map((row) => row.map((value, index) => {
    const nCodes = mask.length;
    let cursor = 0;
    for (let target = 1; target < nCodes; target += 1) {
      for (let source = 0; source < target; source += 1) {
        if (cursor === index) return value * (mask[source]?.[target] ?? 1);
        cursor += 1;
      }
    }
    return value;
  }));
}
function applyWeightBy(rows, columns, weightBy) {
  if (weightBy === "binary" || weightBy === "sum") return rows;
  return rows.map((row) => {
    const next = { ...row };
    for (const column of columns) {
      const raw = row[column];
      const value = typeof raw === "number" ? raw : Number(raw);
      next[column] = weightBy([Number.isFinite(value) ? value : 0]);
    }
    return next;
  });
}
function attachMatrixRows(baseRows, matrix, columns) {
  if (baseRows.length !== matrix.length) {
    throw new Error(`Cannot attach ${matrix.length} matrix rows to ${baseRows.length} table rows.`);
  }
  return baseRows.map((row, rowIndex) => {
    const next = { ...row };
    for (let colIndex = 0; colIndex < columns.length; colIndex += 1) {
      next[columns[colIndex] ?? `V${colIndex + 1}`] = matrix[rowIndex]?.[colIndex] ?? 0;
    }
    return next;
  });
}
function buildMetaData(rowsWithUnit, units, metadata, includeMeta) {
  const stableMetadata = includeMeta ? metadata.filter((column) => {
    const valuesByUnit = /* @__PURE__ */ new Map();
    for (const row of rowsWithUnit) {
      const unit = String(row.ENA_UNIT ?? "");
      const values = valuesByUnit.get(unit) ?? /* @__PURE__ */ new Set();
      values.add(String(row[column] ?? ""));
      valuesByUnit.set(unit, values);
    }
    return [...valuesByUnit.values()].every((values) => values.size <= 1);
  }) : [];
  const columns = ["ENA_UNIT", ...units, ...stableMetadata];
  const byUnit = /* @__PURE__ */ new Map();
  for (const row of rowsWithUnit) {
    const unit = String(row.ENA_UNIT ?? "");
    if (!byUnit.has(unit)) {
      byUnit.set(unit, Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
    }
  }
  return [...byUnit.values()];
}
function mergeMetaIntoCounts(countRows, metaRows, codeColumns) {
  const metaByUnit = new Map(metaRows.map((row) => [String(row.ENA_UNIT ?? ""), row]));
  return countRows.map((row) => {
    const meta = metaByUnit.get(String(row.ENA_UNIT ?? "")) ?? {};
    return { ...meta, ...Object.fromEntries(codeColumns.map((column) => [column, row[column] ?? 0])) };
  });
}
function makeTrajectoryMetaData(countRows, units) {
  return countRows.map((row) => Object.fromEntries([...units, "ENA_UNIT"].map((column) => [column, row[column] ?? null])));
}
function makeTrajectoryConnectionCounts(countRows, units, codeColumns) {
  return countRows.map((row) => ({
    ...Object.fromEntries(units.map((column) => [column, row[column] ?? null])),
    ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, units),
    ...Object.fromEntries(codeColumns.map((column) => [column, row[column] ?? 0]))
  }));
}
function numericConnectionMatrix(rows, columns) {
  return rows.map((row) => columns.map((column) => {
    const raw = row[column];
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) ? value : 0;
  }));
}
function makeRowCoOccurrences(rowsWithUnit, units, conversation, codes, codeColumns, weightBy, window, windowSizeBack, windowSizeForward, mask) {
  const binary = weightBy === "binary";
  const adjacencyColumns = adjacencyColumnNames(codeColumns.length);
  let coRows = [];
  if (window === "Conversation") {
    const conversationBy = [...conversation, "ENA_UNIT"];
    const groups = groupBy(rowsWithUnit, (row) => mergeColumns(row, conversationBy));
    for (const groupRows of groups.values()) {
      const first = groupRows[0];
      if (!first) continue;
      const codeMatrix = toNumericMatrix(groupRows, codes);
      const summed = sumColumns(codeMatrix);
      const co = binary ? vectorToUpperTriangle(summed).map((value) => value > 0 ? 1 : 0) : vectorToUpperTriangle(summed);
      coRows.push({
        ...Object.fromEntries(codes.map((code, index) => [code, summed[index] ?? 0])),
        ...Object.fromEntries(conversation.map((column) => [column, first[column] ?? null])),
        ...Object.fromEntries(units.map((column) => [column, first[column] ?? null])),
        ENA_UNIT: first.ENA_UNIT ?? mergeColumns(first, units),
        ...Object.fromEntries(adjacencyColumns.map((column, index) => [column, co[index] ?? 0]))
      });
    }
  } else {
    const groupedIndexes = /* @__PURE__ */ new Map();
    rowsWithUnit.forEach((row, index) => {
      const key = mergeColumns(row, conversation);
      const current = groupedIndexes.get(key);
      if (current) current.push(index);
      else groupedIndexes.set(key, [index]);
    });
    const orderedRows = Array.from({ length: rowsWithUnit.length }, () => ({}));
    for (const indexes of groupedIndexes.values()) {
      const groupRows = indexes.map((index) => rowsWithUnit[index]).filter((row) => row !== void 0);
      const codeMatrix = toNumericMatrix(groupRows, codes);
      const coMatrix = windowSizeBack === 1 && windowSizeForward === 0 ? rowsToCoOccurrences(codeMatrix, binary) : refWindowMatrix(codeMatrix, windowSizeBack, windowSizeForward, binary);
      const attachedRows = attachMatrixRows(groupRows, coMatrix, adjacencyColumns);
      indexes.forEach((rowIndex, groupIndex) => {
        orderedRows[rowIndex] = attachedRows[groupIndex] ?? groupRows[groupIndex] ?? {};
      });
    }
    coRows = orderedRows;
  }
  const masked = attachMatrixRows(coRows, applyMask(numericConnectionMatrix(coRows, adjacencyColumns), mask), adjacencyColumns);
  return renameAdjacencyColumns(applyWeightBy(masked, adjacencyColumns, weightBy), adjacencyColumns, codeColumns);
}
function makeEndpointCounts(rowConnections, units, codeColumns) {
  const summed = sumRowsBy(rowConnections, units, codeColumns);
  return summed.map((row) => ({ ...row, ENA_UNIT: mergeColumns(row, units) }));
}
function makeTrajectoryCounts(rowConnections, units, conversation, codeColumns, model) {
  const trajectoryKey = [...units, ...conversation];
  const perStep = sumRowsBy(rowConnections, trajectoryKey, codeColumns).map((row) => ({
    ...row,
    ENA_UNIT: mergeColumns(row, units),
    TRAJ_UNIT: mergeColumns(row, conversation)
  }));
  if (model === "SeparateTrajectory") {
    return { counts: perStep, trajectories: perStep.map((row) => Object.fromEntries([...units, "ENA_UNIT", ...conversation].map((column) => [column, row[column] ?? null]))) };
  }
  const grouped = groupBy(perStep, (row) => String(row.ENA_UNIT ?? ""));
  const accumulated = [];
  for (const groupRows of grouped.values()) {
    const running = Object.fromEntries(codeColumns.map((column) => [column, 0]));
    for (const row of groupRows) {
      for (const column of codeColumns) {
        running[column] = Number(running[column] ?? 0) + Number(row[column] ?? 0);
      }
      accumulated.push({ ...row, ...running });
    }
  }
  return { counts: accumulated, trajectories: accumulated.map((row) => Object.fromEntries([...units, "ENA_UNIT", ...conversation].map((column) => [column, row[column] ?? null]))) };
}
function accumulateData(options) {
  const rows = options.rows;
  const units = options.units;
  const conversation = options.conversation;
  const codes = options.codes;
  const metadata = options.metadata ?? [];
  const model = normalizeModel(options.model);
  const weightBy = normalizeWeightBy(options.weightBy);
  const window = normalizeWindow(options.window);
  const windowSizeBack = options.windowSizeBack ?? 1;
  const windowSizeForward = options.windowSizeForward ?? 0;
  const includeMeta = options.includeMeta ?? true;
  const unitsUsed = options.unitsUsed;
  assertNonEmptyColumns(units, "units");
  assertNonEmptyColumns(conversation, "conversation");
  assertNonEmptyColumns(codes, "codes");
  assertRowsHaveColumns(rows, [...units, ...conversation, ...codes, ...metadata]);
  const rawRows = addMergedColumn(rows, "ENA_UNIT", units);
  const codeColumns = stringVectorToUpperTriangle(codes);
  const rowConnectionCounts = makeRowCoOccurrences(
    rawRows,
    units,
    conversation,
    codes,
    codeColumns,
    weightBy,
    window,
    window === "Conversation" ? Number.POSITIVE_INFINITY : windowSizeBack,
    windowSizeForward,
    options.mask
  );
  let metaData = buildMetaData(rawRows, units, metadata, includeMeta);
  let countRows;
  let trajectories;
  let connectionCounts;
  const unitFilter = unitsUsed ? new Set(unitsUsed.map(String)) : void 0;
  const countedRowConnections = unitFilter ? rowConnectionCounts.filter((row) => unitFilter.has(String(row.ENA_UNIT ?? ""))) : rowConnectionCounts;
  if (model === "EndPoint") {
    countRows = makeEndpointCounts(countedRowConnections, units, codeColumns);
    const countUnits = new Set(countRows.map((row) => String(row.ENA_UNIT ?? "")));
    metaData = metaData.filter((row) => countUnits.has(String(row.ENA_UNIT ?? "")));
    connectionCounts = mergeMetaIntoCounts(countRows, metaData, codeColumns);
  } else {
    const trajectoryResult = makeTrajectoryCounts(countedRowConnections, units, conversation, codeColumns, model);
    countRows = trajectoryResult.counts;
    trajectories = trajectoryResult.trajectories;
    metaData = makeTrajectoryMetaData(countRows, units);
    connectionCounts = makeTrajectoryConnectionCounts(countRows, units, codeColumns);
  }
  const connectionMatrix = numericConnectionMatrix(connectionCounts, codeColumns);
  const unitLabels = countRows.map((row) => model === "EndPoint" ? String(row.ENA_UNIT ?? "") : `${String(row.ENA_UNIT ?? "")}::${String(row.TRAJ_UNIT ?? "")}`);
  const result = {
    modelType: model,
    codes,
    units,
    conversation,
    codeColumns,
    adjacencyKey: adjacencyKey(codes),
    rawRows,
    rowConnectionCounts,
    connectionCounts,
    connectionMatrix,
    metaData,
    unitLabels,
    functionParams: {
      model,
      weightBy,
      window,
      windowSizeBack,
      windowSizeForward,
      includeMeta,
      ...unitsUsed ? { unitsUsed } : {}
    }
  };
  if (trajectories) result.trajectories = trajectories;
  return result;
}

// src/rotation/svd.ts
function svdRotation(pointsForProjection) {
  const covariance = covarianceLike(pointsForProjection);
  const eigen = symmetricJacobiEigen(covariance);
  const divisor = Math.max(1, pointsForProjection.length - 1);
  const eigenvalues = eigen.eigenvalues.map((value) => value / divisor);
  return {
    rotationMatrix: eigen.eigenvectors,
    rotationColumns: eigen.eigenvalues.map((_value, index) => `SVD${index + 1}`),
    eigenvalues
  };
}

// src/rotation/nodePositions.ts
function nodeWeightsFromLineWeights(lineWeights, numNodes) {
  return lineWeights.map((adjacency) => {
    const weights = Array.from({ length: numNodes }, () => 0);
    let z = 0;
    for (let x = 0; x < numNodes - 1; x += 1) {
      for (let y = 0; y <= x; y += 1) {
        const value = adjacency[z] ?? 0;
        weights[x + 1] = (weights[x + 1] ?? 0) + 0.5 * value;
        weights[y] = (weights[y] ?? 0) + 0.5 * value;
        z += 1;
      }
    }
    const length = Math.max(1e-4, weights.reduce((sum, value) => sum + Math.abs(value), 0));
    return weights.map((value) => value / length);
  });
}
function directedWeightsFromLineWeights(lineWeights, numNodes) {
  return lineWeights.map((adjacency) => {
    const weights = Array.from({ length: numNodes }, () => 0);
    let z = 0;
    for (let x = 0; x < numNodes; x += 1) {
      for (let y = 0; y < numNodes; y += 1) {
        const value = adjacency[z] ?? 0;
        weights[x] = (weights[x] ?? 0) + value;
        weights[y] = (weights[y] ?? 0) + value;
        z += 1;
      }
    }
    const length = Math.max(1e-4, weights.reduce((sum, value) => sum + Math.abs(value), 0));
    return weights.map((value) => value / length);
  });
}
function solveNodePositionsFromWeights(weights, points) {
  const wt = transpose(weights);
  const normal = multiplyMatrices(wt, weights);
  const dims = points[0]?.length ?? 0;
  const nodeCount = weights[0]?.length ?? 0;
  const nodeColumns = [];
  for (let dim = 0; dim < dims; dim += 1) {
    const rhs = multiplyMatrices(wt, points.map((row) => [row[dim] ?? 0])).map((row) => row[0] ?? 0);
    nodeColumns.push(solveLinearSystem(normal, rhs));
  }
  const nodes = Array.from({ length: nodeCount }, (_unused, nodeIndex) => nodeColumns.map((col) => col[nodeIndex] ?? 0));
  return { nodes, centroids: multiplyMatrices(weights, nodes), weights };
}
function lwsLeastSquaresPositions(lineWeights, points, numNodes) {
  if (lineWeights.length !== points.length) {
    throw new Error("lineWeights and points must have the same number of rows.");
  }
  if (points.length === 0) return { nodes: [], centroids: [], weights: [] };
  const weights = nodeWeightsFromLineWeights(lineWeights, numNodes);
  return solveNodePositionsFromWeights(weights, points);
}
function directedNodePositions(lineWeights, points) {
  if (lineWeights.length !== points.length) {
    throw new Error("lineWeights and points must have the same number of rows.");
  }
  if (points.length === 0) return { nodes: [], centroids: [], weights: [] };
  const numNodes = Math.ceil(Math.sqrt(lineWeights[0]?.length ?? 0));
  return solveNodePositionsFromWeights(directedWeightsFromLineWeights(lineWeights, numNodes), points);
}
function directedNodePositionsWithGroundResponseAdded(lineWeights, points) {
  if (lineWeights.length !== points.length) {
    throw new Error("lineWeights and points must have the same number of rows.");
  }
  if (points.length === 0) return { nodes: [], centroids: [], weights: [] };
  const numNodes = Math.ceil(Math.sqrt(lineWeights[0]?.length ?? 0));
  const weights = directedWeightsFromLineWeights(lineWeights, numNodes);
  const addedWeights = [];
  const addedPoints = [];
  for (let row = 0; row + 1 < weights.length; row += 2) {
    addedWeights.push(Array.from({ length: numNodes }, (_unused, col) => (weights[row]?.[col] ?? 0) + (weights[row + 1]?.[col] ?? 0)));
    const dims = points[0]?.length ?? 0;
    addedPoints.push(Array.from({ length: dims }, (_unused, col) => (points[row]?.[col] ?? 0) + (points[row + 1]?.[col] ?? 0)));
  }
  const solved = solveNodePositionsFromWeights(addedWeights, addedPoints);
  return { nodes: solved.nodes, centroids: multiplyMatrices(weights, solved.nodes), weights };
}
function nodesAsRows(codes, nodeMatrix, dimensions) {
  return nodeMatrix.map((row, index) => ({
    code: codes[index] ?? String(index),
    ...Object.fromEntries(dimensions.map((dimension, dimIndex) => [dimension, row[dimIndex] ?? 0]))
  }));
}
function centroidsAsRows(unitLabels, centroidMatrix, dimensions) {
  return centroidMatrix.map((row, index) => ({
    unit: unitLabels[index] ?? String(index),
    ...Object.fromEntries(dimensions.map((dimension, dimIndex) => [dimension, row[dimIndex] ?? 0]))
  }));
}

// src/rotation/elasticNet.ts
function softThreshold(value, penalty) {
  if (value > penalty) return value - penalty;
  if (value < -penalty) return value + penalty;
  return 0;
}
function squaredNormColumn(matrix, col) {
  return matrix.reduce((sum, row) => {
    const value = row[col] ?? 0;
    return sum + value * value;
  }, 0);
}
function responseColumn(response, col) {
  return response.map((row) => row[col] ?? 0);
}
function fitColumn(design, response, options) {
  const rows = design.length;
  const cols = design[0]?.length ?? 0;
  const beta = Array.from({ length: cols }, () => 0);
  beta[0] = response.reduce((sum, value) => sum + value, 0) / Math.max(1, rows);
  const predicted = Array.from({ length: rows }, () => beta[0] ?? 0);
  const columnNorms = Array.from({ length: cols }, (_unused, col) => squaredNormColumn(design, col) / Math.max(1, rows));
  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    let maxChange = 0;
    for (let col = 0; col < cols; col += 1) {
      const penaltyFactor = options.penaltyFactor[col] ?? 1;
      const old = beta[col] ?? 0;
      let rho = 0;
      for (let row = 0; row < rows; row += 1) {
        const x = design[row]?.[col] ?? 0;
        rho += x * ((response[row] ?? 0) - (predicted[row] ?? 0) + x * old);
      }
      rho /= Math.max(1, rows);
      const denom = (columnNorms[col] ?? 0) + options.lambda * (1 - options.alpha) * penaltyFactor;
      const next = col === 0 || penaltyFactor === 0 ? rho / (denom === 0 ? 1e-12 : denom) : softThreshold(rho, options.lambda * options.alpha * penaltyFactor) / (denom === 0 ? 1e-12 : denom);
      beta[col] = next;
      const delta = next - old;
      maxChange = Math.max(maxChange, Math.abs(delta));
      if (delta !== 0) {
        for (let row = 0; row < rows; row += 1) {
          predicted[row] = (predicted[row] ?? 0) + (design[row]?.[col] ?? 0) * delta;
        }
      }
    }
    if (maxChange < options.tolerance) break;
  }
  return beta;
}
function elasticNet(design, response, options = {}) {
  const fullOptions = {
    alpha: options.alpha ?? 1,
    lambda: options.lambda ?? 0.01,
    maxIterations: options.maxIterations ?? 1e3,
    tolerance: options.tolerance ?? 1e-8,
    penaltyFactor: options.penaltyFactor ?? Array.from({ length: design[0]?.length ?? 0 }, (_unused, index) => index === 0 ? 0 : 1)
  };
  const columns = response[0]?.length ?? 0;
  const coefficients = Array.from({ length: columns }, (_unused, col) => fitColumn(design, responseColumn(response, col), fullOptions));
  return { coefficients: transpose(coefficients), lambda: fullOptions.lambda };
}
function subsetRows(matrix, indexes) {
  return indexes.map((index) => matrix[index] ?? []);
}
function mse(actual, predicted) {
  let total = 0;
  let count = 0;
  for (let row = 0; row < actual.length; row += 1) {
    for (let col = 0; col < (actual[row]?.length ?? 0); col += 1) {
      const diff = (actual[row]?.[col] ?? 0) - (predicted[row]?.[col] ?? 0);
      total += diff * diff;
      count += 1;
    }
  }
  return total / Math.max(1, count);
}
function elasticNetCV(design, response, options = {}) {
  const rows = design.length;
  const folds = Math.max(2, Math.min(options.folds ?? 5, rows));
  const lambdas = options.lambdas ?? [1, 0.3, 0.1, 0.03, 0.01, 3e-3, 1e-3];
  let bestLambda = lambdas[0] ?? 0.01;
  let bestMse = Number.POSITIVE_INFINITY;
  const indexes = Array.from({ length: rows }, (_unused, index) => index);
  for (const lambda of lambdas) {
    let total = 0;
    for (let fold = 0; fold < folds; fold += 1) {
      const test = indexes.filter((index) => index % folds === fold);
      const train = indexes.filter((index) => index % folds !== fold);
      const fit = elasticNet(subsetRows(design, train), subsetRows(response, train), { ...options, lambda });
      total += mse(subsetRows(response, test), multiplyMatrices(subsetRows(design, test), fit.coefficients));
    }
    const score = total / folds;
    if (score < bestMse) {
      bestMse = score;
      bestLambda = lambda;
    }
  }
  return elasticNet(design, response, { ...options, lambda: bestLambda });
}

// src/rotation/custom.ts
function isBooleanSelector(selector) {
  return selector.every((value) => typeof value === "boolean");
}
function groupMask(selector, rows) {
  if (isBooleanSelector(selector)) {
    if (selector.length !== rows.length) throw new Error("Group selector length must match row count.");
    return selector;
  }
  const values = new Set(selector.map(String));
  return rows.map((row) => values.has(String(row.ENA_UNIT ?? row.unit ?? "")));
}
function isSelector(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" || typeof entry === "boolean");
}
function normalizeMeanGroups(groups) {
  if (Array.isArray(groups) && groups.length === 2 && isSelector(groups[0]) && isSelector(groups[1])) {
    return [[groups[0], groups[1]]];
  }
  return groups;
}
function rowsByMask(matrix, mask) {
  return matrix.filter((_row, index) => mask[index] ?? false);
}
function columnsToMatrix(columns, rows) {
  return Array.from({ length: rows }, (_unused, row) => columns.map((col) => col[row] ?? 0));
}
function combineRotationColumns(columns) {
  const rowCount = columns[0]?.length ?? 0;
  return columnsToMatrix(columns, rowCount);
}
function orthogonalSvd(data, leadingColumns) {
  const width = data[0]?.length ?? 0;
  if (width === 0) return [];
  const q = gramSchmidtComplete(leadingColumns, width);
  const leadingCount = leadingColumns.length;
  const qLeading = q.map((row) => row.slice(0, leadingCount));
  const qRest = q.map((row) => row.slice(leadingCount));
  if ((qRest[0]?.length ?? 0) === 0) return qLeading;
  const xbar = multiplyMatrices(data, qRest);
  const restRotation = svdRotation(xbar).rotationMatrix;
  const rest = multiplyMatrices(qRest, restRotation);
  return q.map((_row, index) => [...qLeading[index] ?? [], ...rest[index] ?? []]);
}
function makeColumnNames(prefix, count, start = 1) {
  return Array.from({ length: count }, (_unused, index) => `${prefix}${index + start}`);
}
function rotateWithLeadingColumns(data, leadingColumns, leadingNames) {
  const rotationMatrix = orthogonalSvd(data, leadingColumns);
  const residualCount = Math.max(0, (rotationMatrix[0]?.length ?? 0) - leadingNames.length);
  return {
    rotationMatrix,
    rotationColumns: [...leadingNames, ...makeColumnNames("SVD", residualCount, leadingNames.length + 1)],
    eigenvalues: []
  };
}
function rotateByMean(pointsForProjection, enadata, params) {
  const groups = normalizeMeanGroups(params.groups);
  if (groups.length === 0) throw new Error("Unable to rotate without at least one pair of groups.");
  const rows = enadata.connectionCounts;
  const data = centerData(pointsForProjection);
  let deflated = data;
  const weights = [];
  for (const [leftSelector, rightSelector] of groups) {
    const left = rowsByMask(deflated, groupMask(leftSelector, rows));
    const right = rowsByMask(deflated, groupMask(rightSelector, rows));
    if (left.length === 0 || right.length === 0) throw new Error("Mean rotation groups must both contain at least one row.");
    const diff = subtractVectors(meanColumns(left), meanColumns(right));
    const direction = normalizeVector(diff);
    if (l2Norm(direction) === 0) throw new Error("Mean rotation groups have identical means.");
    deflated = subtractOuterProjection(deflated, direction);
    weights.push(direction);
  }
  return rotateWithLeadingColumns(deflated, weights, makeColumnNames("MR", weights.length));
}
function scalarToNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
function metadataVector(rows, columnName) {
  return rows.map((row) => row[columnName] ?? null);
}
function encodeVector(values) {
  const numeric = values.map(scalarToNumber);
  if (numeric.every(Number.isFinite)) return numeric;
  const levels = [...new Set(values.map((value) => String(value)))].sort();
  return values.map((value) => levels.indexOf(String(value)) + 1);
}
function isNumericVector(values) {
  return values.map(scalarToNumber).every(Number.isFinite);
}
function resolveVarNames(value) {
  return Array.isArray(value) ? value : [value];
}
function simpleLinearFit(response, predictor) {
  const design = predictor.map((value) => [1, value]);
  const coefficients = designSolve(design, response);
  return { coefficients, fitted: multiplyMatrices(design, coefficients) };
}
function categoricalMainEffect(response, target) {
  const levels = [...new Set(target.map((value) => String(value)))];
  const means = /* @__PURE__ */ new Map();
  for (const level of levels) {
    const rows = response.filter((_row, index) => String(target[index] ?? "") === level);
    means.set(level, meanColumns(rows));
  }
  return response.map((_row, index) => means.get(String(target[index] ?? "")) ?? []);
}
function computeBetweenGroupScatter(matrix, groups) {
  const width = matrix[0]?.length ?? 0;
  const totalMean = meanColumns(matrix);
  const out = Array.from({ length: width }, () => Array.from({ length: width }, () => 0));
  const levels = [...new Set(groups.map((value) => String(value)))];
  for (const level of levels) {
    const rows = matrix.filter((_row, index) => String(groups[index] ?? "") === level);
    if (rows.length === 0) continue;
    const diff = subtractVectors(meanColumns(rows), totalMean);
    for (let i = 0; i < width; i += 1) {
      for (let j = 0; j < width; j += 1) {
        const outRow = out[i];
        if (outRow) outRow[j] = (outRow[j] ?? 0) + rows.length * (diff[i] ?? 0) * (diff[j] ?? 0);
      }
    }
  }
  return out;
}
function gmr(points, rows, vars) {
  const target = metadataVector(rows, vars[0] ?? "");
  const targetEncoded = encodeVector(target);
  const numericTarget = isNumericVector(target);
  const simple = simpleLinearFit(points, targetEncoded);
  let fittedMainEffect = numericTarget ? simple.fitted : categoricalMainEffect(points, target);
  if (vars.length > 1) {
    const design = buildMetadataDesign(rows, vars);
    const x1Columns = design.labels.map((label, index) => index === 0 || label === (vars[0] ?? "") ? 0 : 1);
    const coefficients = elasticNetCV(design.matrix, points, { alpha: 1, penaltyFactor: x1Columns }).coefficients;
    const targetOnly = design.matrix.map((row) => row.map((value, index) => index <= 1 ? value : 0));
    fittedMainEffect = multiplyMatrices(targetOnly, coefficients);
  }
  if (numericTarget) {
    return {
      direction: normalizeVector(simple.coefficients[1] ?? []),
      fittedMainEffect,
      target
    };
  }
  const scatter = computeBetweenGroupScatter(fittedMainEffect, target);
  const eigen = symmetricJacobiEigen(scatter);
  return {
    direction: normalizeVector(eigen.eigenvectors.map((row) => row[0] ?? 0)),
    fittedMainEffect,
    target
  };
}
function rotateByGeneralized(pointsForProjection, enadata, params) {
  const x = gmr(pointsForProjection, enadata.metaData, resolveVarNames(params.xVar));
  const a = pointsForProjection;
  let deflated = subtractOuterProjection(a, x.direction);
  let x1;
  if (params.select2Groups) {
    const [left, right] = params.select2Groups;
    const leftRows = deflated.filter((_row, index) => String(x.target[index] ?? "") === String(left));
    const rightRows = deflated.filter((_row, index) => String(x.target[index] ?? "") === String(right));
    if (leftRows.length > 0 && rightRows.length > 0) {
      const diff = subtractVectors(meanColumns(leftRows), meanColumns(rightRows));
      if (l2Norm(diff) > 1e-10) x1 = normalizeVector(diff);
    }
  }
  if (!x1) {
    const svd = svdRotation(x.fittedMainEffect);
    x1 = svd.rotationMatrix.map((row) => row[0] ?? 0);
  }
  const projection = dot(x1, x.direction);
  if (Math.abs(projection) < 0.99) {
    x1 = normalizeVector(subtractVectors(x1, x.direction.map((value) => value * projection)));
    deflated = subtractOuterProjection(deflated, x1);
  }
  const yDirection = params.yVar ? gmr(deflated, enadata.metaData, resolveVarNames(params.yVar)).direction : svdRotation(deflated).rotationMatrix.map((row) => row[0] ?? 0);
  const yName = params.yVar ? "RR2" : "SVD2";
  const deflatedByBoth = subtractOuterProjection(subtractOuterProjection(a, x.direction), yDirection);
  const residual = svdRotation(deflatedByBoth).rotationMatrix;
  const residualCount = Math.max(0, (a[0]?.length ?? 0) - 2);
  const columns = [x.direction, normalizeVector(yDirection)];
  for (let index = 0; index < residualCount; index += 1) columns.push(residual.map((row) => row[index] ?? 0));
  return {
    rotationMatrix: combineRotationColumns(columns).map((row) => row.slice(0, a[0]?.length ?? 0)),
    rotationColumns: ["RR1", yName, ...makeColumnNames("SVD", residualCount, 3)],
    eigenvalues: []
  };
}
function stripLmWrapper(formula) {
  const match = formula.match(/formula\s*=\s*([^,)]+)/);
  if (match?.[1]) return match[1].trim();
  return formula.replace(/^lm\s*\(/, "").replace(/\)$/, "").trim();
}
function parseFormula(formula) {
  const stripped = stripLmWrapper(formula);
  const [lhsRaw, rhsRaw] = stripped.split("~");
  const lhs = lhsRaw?.trim();
  const rhs = rhsRaw?.trim();
  if (!lhs || !rhs) throw new Error(`Invalid regression formula: ${formula}`);
  return {
    lhs,
    rhsTerms: rhs.split("+").map((term) => term.trim()).filter(Boolean)
  };
}
function buildMetadataDesign(rows, terms) {
  const columns = [Array.from({ length: rows.length }, () => 1)];
  const labels = ["(Intercept)"];
  for (const term of terms) {
    const pieces = term.split(":").map((piece) => piece.trim());
    let values = Array.from({ length: rows.length }, () => 1);
    for (const piece of pieces) {
      const encoded = encodeVector(metadataVector(rows, piece));
      values = values.map((value, index) => value * (encoded[index] ?? 0));
    }
    columns.push(values);
    labels.push(term);
  }
  return { matrix: columnsToMatrix(columns, rows.length), labels };
}
function buildFormulaDesign(rows, points, terms) {
  const columns = [Array.from({ length: rows.length }, () => 1)];
  const labels = ["(Intercept)"];
  for (const term of terms) {
    const pieces = term.split(":").map((piece) => piece.trim());
    const hasV = pieces.includes("V");
    const nonV = pieces.filter((piece) => piece !== "V");
    const metaMultiplier = nonV.reduce(
      (current, piece) => {
        const encoded = encodeVector(metadataVector(rows, piece));
        return current.map((value, index) => value * (encoded[index] ?? 0));
      },
      Array.from({ length: rows.length }, () => 1)
    );
    if (hasV) {
      const width = points[0]?.length ?? 0;
      for (let dim = 0; dim < width; dim += 1) {
        columns.push(points.map((row, index) => (row[dim] ?? 0) * (metaMultiplier[index] ?? 1)));
        labels.push(nonV.length > 0 ? `V${dim + 1}:${nonV.join(":")}` : `V${dim + 1}`);
      }
    } else {
      columns.push(metaMultiplier);
      labels.push(term);
    }
  }
  return { matrix: columnsToMatrix(columns, rows.length), labels };
}
function firstPredictorVectorFromRegression(points, rows, formula, fallbackName) {
  const spec = parseFormula(formula);
  const design = buildMetadataDesign(rows, spec.rhsTerms);
  const coefficients = designSolve(design.matrix, points);
  return {
    vector: normalizeVector(coefficients[1] ?? []),
    name: `${fallbackName || design.labels[1] || spec.lhs}_reg`
  };
}
function vCoefficientVectorFromRegression(points, rows, formula) {
  const spec = parseFormula(formula);
  const design = buildFormulaDesign(rows, points, spec.rhsTerms);
  const response = encodeVector(metadataVector(rows, spec.lhs)).map((value) => [value]);
  const coefficients = designSolve(design.matrix, response);
  const vCoefficients = design.labels.map((label, index) => ({ label, value: coefficients[index]?.[0] ?? 0 })).filter((entry) => entry.label.startsWith("V") && !entry.label.includes(":")).map((entry) => entry.value);
  return {
    vector: normalizeVector(vCoefficients),
    name: "V_reg"
  };
}
function rotateByRegression(pointsForProjection, enadata, params) {
  const x = firstPredictorVectorFromRegression(pointsForProjection, enadata.metaData, params.xVar, enadata.codeColumns[0] ?? "V");
  let deflated = subtractOuterProjection(pointsForProjection, x.vector);
  const columns = [x.vector];
  const names = [x.name];
  if (params.yVar) {
    const y = firstPredictorVectorFromRegression(deflated, enadata.metaData, params.yVar, enadata.codeColumns[0] ?? "V");
    columns.push(y.vector);
    names.push(y.name);
    deflated = subtractOuterProjection(deflated, y.vector);
  }
  return rotateWithLeadingColumns(deflated, columns, names);
}
function rotateByRegression2(pointsForProjection, enadata, params) {
  const x = vCoefficientVectorFromRegression(pointsForProjection, enadata.metaData, params.xVar);
  let deflated = subtractOuterProjection(pointsForProjection, x.vector);
  const columns = [x.vector];
  const names = [x.name];
  if (params.yVar) {
    const y = vCoefficientVectorFromRegression(deflated, enadata.metaData, params.yVar);
    columns.push(y.vector);
    names.push(y.name);
    deflated = subtractOuterProjection(deflated, y.vector);
  }
  return rotateWithLeadingColumns(deflated, columns, names);
}
function henaPredictorColumns(rows, params) {
  const centering = params.centering ?? true;
  const both = [params.xVar, ...params.yVar ? [params.yVar] : []];
  const controlVars = params.controlVars ?? [];
  const vars = params.formula ? parseFormula(`V ~ ${params.formula}`).rhsTerms : [...both, ...controlVars, ...params.includeXY && params.yVar ? [`${params.xVar}:${params.yVar}`] : []];
  const encoded = /* @__PURE__ */ new Map();
  for (const name of [...new Set(vars.flatMap((term) => term.split(":").map((piece) => piece.trim())))]) {
    if (!name) continue;
    const values = encodeVector(metadataVector(rows, name));
    const mean = both.includes(name) && centering ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    encoded.set(name, values.map((value) => value - mean));
  }
  const columns = [Array.from({ length: rows.length }, () => 1)];
  const names = ["(Intercept)"];
  for (const term of vars) {
    const pieces = term.split(":").map((piece) => piece.trim()).filter(Boolean);
    const columnValues = pieces.reduce(
      (current, piece) => current.map((value, index) => value * (encoded.get(piece)?.[index] ?? 0)),
      Array.from({ length: rows.length }, () => 1)
    );
    columns.push(columnValues);
    names.push(term);
  }
  return { matrix: columnsToMatrix(columns, rows.length), names, both };
}
function rotateByHena(pointsForProjection, enadata, params) {
  const data = centerData(pointsForProjection);
  const design = henaPredictorColumns(enadata.metaData, params);
  const coefficients = designSolve(design.matrix, data);
  const leadingColumns = [];
  const leadingNames = [];
  for (const variableName of design.both) {
    const coefficientIndex = design.names.indexOf(variableName);
    if (coefficientIndex < 0) continue;
    let vector = coefficients[coefficientIndex] ?? [];
    for (const previous of leadingColumns) {
      vector = subtractVectors(vector, previous.map((value) => value * dot(vector, previous)));
    }
    vector = normalizeVector(vector);
    if (l2Norm(vector) > 0) {
      leadingColumns.push(vector);
      leadingNames.push(`${leadingColumns.length === 1 ? "x" : "y"}_${variableName}`);
    }
  }
  if (leadingColumns.length === 0) throw new Error("HENA rotation could not derive a non-zero rotation vector.");
  const deflated = deflateMatrix(data, leadingColumns);
  const result = rotateWithLeadingColumns(deflated, leadingColumns, leadingNames);
  const svd = svdRotation(deflated);
  return { ...result, eigenvalues: svd.eigenvalues };
}
function anchorVector(anchor, enadata, width) {
  if (Array.isArray(anchor)) {
    if (anchor.length !== width) throw new Error("Spherical rotation anchor length must match adjacency width.");
    return normalizeVector(anchor);
  }
  if (typeof anchor === "string") {
    const index = enadata.codeColumns.indexOf(anchor);
    if (index < 0) throw new Error(`Unknown spherical rotation anchor: ${anchor}`);
    return Array.from({ length: width }, (_unused, col) => col === index ? 1 : 0);
  }
  return Array.from({ length: width }, (_unused, col) => col === 0 ? 1 : 0);
}
function rotateBySpherical(pointsForProjection, enadata, params = {}) {
  const width = pointsForProjection[0]?.length ?? 0;
  const first = anchorVector(params.anchor, enadata, width);
  let second = anchorVector(params.secondaryAnchor, enadata, width);
  second = normalizeVector(subtractVectors(second, first.map((value) => value * dot(second, first))));
  const leading = l2Norm(second) > 0 ? [first, second] : [first];
  const deflated = deflateMatrix(pointsForProjection, leading);
  return rotateWithLeadingColumns(deflated, leading, leading.map((_column, index) => `SPH${index + 1}`));
}
function projectRotation(pointsForProjection, rotationMatrix) {
  return multiplyMatrices(pointsForProjection, rotationMatrix);
}
function deflateMatrix(matrix, vectors) {
  return vectors.reduce((current, vector) => subtractOuterProjection(current, vector), matrix);
}
function residualMatrix(matrix, fitted) {
  return matrixSubtract(matrix, fitted);
}

// src/model.ts
function nonCodePart(row, codeColumns) {
  const codeSet = new Set(codeColumns);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !codeSet.has(key)));
}
function rowsFromMatrix(baseRows, codeColumns, columns, matrix) {
  return baseRows.map((row, rowIndex) => ({
    ...nonCodePart(row, codeColumns),
    ...Object.fromEntries(columns.map((column, columnIndex) => [column, matrix[rowIndex]?.[columnIndex] ?? 0]))
  }));
}
function selectRotationColumns(rotationMatrix, count) {
  return rotationMatrix.map((row) => row.slice(0, count));
}
function rowHasSignal(row) {
  return row.reduce((sum, value) => sum + value, 0) !== 0;
}
function centerForProjection(lineWeights, centerAlignToOrigin, rotationSet) {
  if (rotationSet) {
    const centerVector2 = rotationSet.centerVector;
    return {
      centerVector: centerVector2,
      pointsForProjection: lineWeights.map((row) => centerAlignToOrigin && !rowHasSignal(row) ? row.map(() => 0) : row.map((value, index) => value - (centerVector2[index] ?? 0)))
    };
  }
  if (!centerAlignToOrigin) {
    const centerVector2 = meanColumns(lineWeights);
    return { pointsForProjection: centerData(lineWeights, centerVector2), centerVector: centerVector2 };
  }
  const nonZeroRows = lineWeights.filter(rowHasSignal);
  if (nonZeroRows.length === 0) {
    throw new Error("There were no co-occurrences of codes for any of the units within the model as defined.");
  }
  const centerVector = meanColumns(nonZeroRows);
  return {
    centerVector,
    pointsForProjection: lineWeights.map((row) => rowHasSignal(row) ? row.map((value, index) => value - (centerVector[index] ?? 0)) : row.map(() => 0))
  };
}
function adjacencyKeysEqual(left, right) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other?.source === entry.source && other.target === entry.target && other.sourceIndex === entry.sourceIndex && other.targetIndex === entry.targetIndex;
  });
}
function meanParams(options) {
  const params = options?.params;
  if (!params || !("groups" in params)) throw new Error("Mean rotation requires rotation.params.groups.");
  return params;
}
function generalizedParams(options) {
  const params = options?.params;
  if (!params || !("xVar" in params)) throw new Error("Generalized rotation requires rotation.params.xVar.");
  return params;
}
function regressionParams(options) {
  const params = options?.params;
  if (!params || typeof params.xVar !== "string") throw new Error("Regression rotation requires rotation.params.xVar.");
  return params;
}
function henaParams(options) {
  const params = options?.params;
  if (!params || typeof params.xVar !== "string") throw new Error("HENA rotation requires rotation.params.xVar.");
  return params;
}
function sphericalParams(options) {
  return options?.params ?? {};
}
function makeRotation(enadata, pointsForProjection, options) {
  if (options.rotationSet) {
    if (!adjacencyKeysEqual(enadata.adjacencyKey, options.rotationSet.adjacencyKey)) {
      throw new Error("Rotation sets must have identical adjacency keys.");
    }
    return {
      rotationMatrix: options.rotationSet.rotationMatrix,
      rotationColumns: options.rotationSet.rotationColumns,
      eigenvalues: options.rotationSet.eigenvalues
    };
  }
  const rotation = options.rotation;
  switch (rotation?.method ?? "svd") {
    case "svd":
      return svdRotation(pointsForProjection);
    case "mean":
      return rotateByMean(pointsForProjection, enadata, meanParams(rotation));
    case "generalized":
      return rotateByGeneralized(pointsForProjection, enadata, generalizedParams(rotation));
    case "regression":
      return rotateByRegression(pointsForProjection, enadata, regressionParams(rotation));
    case "regression2":
      return rotateByRegression2(pointsForProjection, enadata, regressionParams(rotation));
    case "hena":
      return rotateByHena(pointsForProjection, enadata, henaParams(rotation));
    case "spherical":
      return rotateBySpherical(pointsForProjection, enadata, sphericalParams(rotation));
  }
}
function makeNodePositions(lineWeights, points, codeCount, options) {
  switch (options.nodePositionMethod ?? "undirected") {
    case "undirected":
      return lwsLeastSquaresPositions(lineWeights, points, codeCount);
    case "directed":
      return directedNodePositions(lineWeights, points);
    case "directed-ground-response":
      return directedNodePositionsWithGroundResponseAdded(lineWeights, points);
  }
}
function makeSet(enadata, options = {}) {
  const dimensions = options.dimensions ?? 2;
  const centerAlignToOrigin = options.centerAlignToOrigin ?? true;
  const lineWeightsMatrix = sphereNorm(enadata.connectionMatrix);
  const { pointsForProjection, centerVector } = centerForProjection(lineWeightsMatrix, centerAlignToOrigin, options.rotationSet);
  const rotationResult = makeRotation(enadata, pointsForProjection, options);
  const dimCount = Math.min(dimensions, rotationResult.rotationColumns.length);
  const dimensionNames = rotationResult.rotationColumns.slice(0, dimCount);
  const selectedRotation = selectRotationColumns(rotationResult.rotationMatrix, dimCount);
  const pointsMatrix = multiplyMatrices(pointsForProjection, selectedRotation);
  const nodePositionResult = makeNodePositions(lineWeightsMatrix, pointsMatrix, enadata.codes.length, options);
  const variances = varianceColumns(pointsMatrix);
  const varianceTotal = variances.reduce((sum, value) => sum + value, 0);
  const variance = Object.fromEntries(dimensionNames.map((name, index) => [name, varianceTotal === 0 ? 0 : (variances[index] ?? 0) / varianceTotal]));
  const rotation = {
    codes: enadata.codes,
    adjacencyKey: enadata.adjacencyKey,
    rotationMatrix: selectedRotation,
    rotationColumns: dimensionNames,
    eigenvalues: rotationResult.eigenvalues.slice(0, dimCount),
    centerVector,
    nodes: options.rotationSet?.nodes ?? nodesAsRows(enadata.codes, nodePositionResult.nodes, dimensionNames)
  };
  return {
    ...enadata,
    lineWeights: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, enadata.codeColumns, lineWeightsMatrix),
    pointsForProjection: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, enadata.codeColumns, pointsForProjection),
    points: rowsFromMatrix(enadata.connectionCounts, enadata.codeColumns, dimensionNames, pointsMatrix),
    rotation,
    variance,
    centroids: centroidsAsRows(enadata.unitLabels, nodePositionResult.centroids, dimensionNames)
  };
}
function projectIn(enadata, by, options = {}) {
  const rotationSet = "rotation" in by ? by.rotation : by;
  return makeSet(enadata, { ...options, rotationSet });
}

// src/ena.ts
function ena(options) {
  const enadata = accumulateData(options);
  const makeOptions = {};
  if (options.dimensions !== void 0) makeOptions.dimensions = options.dimensions;
  if (options.centerAlignToOrigin !== void 0) makeOptions.centerAlignToOrigin = options.centerAlignToOrigin;
  if (options.rotation !== void 0) makeOptions.rotation = options.rotation;
  if (options.rotationSet !== void 0) makeOptions.rotationSet = options.rotationSet;
  if (options.nodePositionMethod !== void 0) makeOptions.nodePositionMethod = options.nodePositionMethod;
  return makeSet(enadata, makeOptions);
}

export {
  accumulateData,
  svdRotation,
  lwsLeastSquaresPositions,
  directedNodePositions,
  directedNodePositionsWithGroundResponseAdded,
  nodesAsRows,
  centroidsAsRows,
  elasticNet,
  elasticNetCV,
  rotateByMean,
  rotateByGeneralized,
  rotateByRegression,
  rotateByRegression2,
  rotateByHena,
  rotateBySpherical,
  projectRotation,
  deflateMatrix,
  residualMatrix,
  makeSet,
  projectIn,
  ena
};
//# sourceMappingURL=chunk-RIVKHBY6.js.map