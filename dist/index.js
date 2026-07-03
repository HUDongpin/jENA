import {
  createENAWorkerClient
} from "./chunk-3FHMM3CQ.js";
import {
  accumulateData,
  centroidsAsRows,
  deflateMatrix,
  directedNodePositions,
  directedNodePositionsWithGroundResponseAdded,
  elasticNet,
  elasticNetCV,
  ena,
  lwsLeastSquaresPositions,
  makeSet,
  nodesAsRows,
  projectIn,
  projectRotation,
  residualMatrix,
  rotateByGeneralized,
  rotateByHena,
  rotateByMean,
  rotateByRegression,
  rotateByRegression2,
  rotateBySpherical,
  svdRotation
} from "./chunk-RIVKHBY6.js";
import {
  addMergedColumn,
  addVectors,
  adjacencyKey,
  assertFiniteNumbers,
  assertNonEmptyColumns,
  assertRectangularMatrix,
  assertRowsHaveColumns,
  centerData,
  cloneMatrix,
  cohensD,
  combnC2,
  covarianceLike,
  designSolve,
  dot,
  gramSchmidtComplete,
  groupBy,
  identity,
  l2Norm,
  matrixAdd,
  matrixSubtract,
  meanColumns,
  mergeColumns,
  multiplyMatrices,
  multiplyMatrixVector,
  normalizeVector,
  numericRowFromColumns,
  outerProduct,
  pearsonCorrelation,
  refWindowLag,
  refWindowMatrix,
  rowsToCoOccurrences,
  rowsWithNumericColumns,
  scalarToString,
  scaleVector,
  selectColumns,
  skipSphereNorm,
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
  triIndices,
  uniqueRows,
  varianceColumns,
  vectorToUpperTriangle,
  zeros
} from "./chunk-CS2S5LAI.js";
import {
  addGroup,
  addNetwork,
  addNodes,
  addPoints,
  addTrajectory,
  createENAPlotModel,
  networkFromConnectionRow,
  renderENAPlot,
  scalePlot,
  toPlotly
} from "./chunk-UJIUOQOU.js";

// src/performance.ts
function rowsToNumericTable(rows, columns) {
  const data = new Float64Array(rows.length * columns.length);
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < columns.length; col += 1) {
      const raw = rows[row]?.[columns[col] ?? ""];
      const value = typeof raw === "number" ? raw : Number(raw);
      data[row * columns.length + col] = Number.isFinite(value) ? value : 0;
    }
  }
  return { data, rows: rows.length, cols: columns.length };
}
function rowsToCoOccurrencesTyped(table, binary = true) {
  const outCols = table.cols * (table.cols - 1) / 2;
  const out = new Float64Array(table.rows * outCols);
  for (let row = 0; row < table.rows; row += 1) {
    let cursor = 0;
    for (let target = 1; target < table.cols; target += 1) {
      for (let source = 0; source < target; source += 1) {
        const value = (table.data[row * table.cols + source] ?? 0) * (table.data[row * table.cols + target] ?? 0);
        out[row * outCols + cursor] = binary ? value > 0 ? 1 : 0 : value;
        cursor += 1;
      }
    }
  }
  return { data: out, rows: table.rows, cols: outCols };
}
function normalizeModel(model) {
  return model ?? "EndPoint";
}
function normalizeWindow(window) {
  return window ?? "MovingStanzaWindow";
}
function normalizeWeightBy(weightBy) {
  return weightBy ?? "binary";
}
function numeric(row, column) {
  const raw = row[column];
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : 0;
}
function zeros2(length) {
  return Array.from({ length }, () => 0);
}
function addVectors2(left, right) {
  const width = Math.max(left.length, right.length);
  return Array.from({ length: width }, (_unused, index) => (left[index] ?? 0) + (right[index] ?? 0));
}
function subtractVectors2(left, right) {
  const width = Math.max(left.length, right.length);
  return Array.from({ length: width }, (_unused, index) => (left[index] ?? 0) - (right[index] ?? 0));
}
function sumCodeVectors(vectors, width) {
  if (vectors.length === 0) return zeros2(width);
  return sumColumns(vectors);
}
function codeValues(row, codes) {
  return codes.map((code) => numeric(row, code));
}
function makeUnitRow(row, units) {
  return { ...row, ENA_UNIT: mergeColumns(row, units) };
}
function applyMaskToCoOccurrence(values2, mask) {
  if (!mask) return values2;
  return values2.map((value, index) => {
    let cursor = 0;
    for (let target = 1; target < mask.length; target += 1) {
      for (let source = 0; source < target; source += 1) {
        if (cursor === index) return value * (mask[source]?.[target] ?? 1);
        cursor += 1;
      }
    }
    return value;
  });
}
function applyWeight(values2, weightBy) {
  if (weightBy === "binary" || weightBy === "sum") return values2;
  return values2.map((value) => weightBy([value]));
}
function coOccurrenceFromSums(total, subtract, binary) {
  const co = subtract ? subtractVectors2(vectorToUpperTriangle(total), vectorToUpperTriangle(subtract)) : vectorToUpperTriangle(total);
  return binary ? co.map((value) => value > 0 ? 1 : 0) : co;
}
function finalizeCoOccurrence(values2, internals) {
  return applyWeight(applyMaskToCoOccurrence(values2, internals.mask), internals.weightBy);
}
function rowWithCoOccurrences(base, co, codeColumns) {
  return {
    ...base,
    ...Object.fromEntries(codeColumns.map((column, index) => [column, co[index] ?? 0]))
  };
}
function ensureMetadata(internals, row, sequence) {
  if (!internals.includeMeta) return;
  const unit = String(row.ENA_UNIT ?? "");
  let state = internals.metadataStates.get(unit);
  if (!state) {
    state = {
      row: Object.fromEntries(["ENA_UNIT", ...internals.units].map((column) => [column, row[column] ?? null])),
      values: /* @__PURE__ */ new Map(),
      unstable: /* @__PURE__ */ new Set(),
      sequence
    };
    for (const column of internals.metadata) state.values.set(column, row[column] ?? null);
    internals.metadataStates.set(unit, state);
    internals.metadataOrder.push(unit);
    return;
  }
  for (const column of internals.metadata) {
    const previous = state.values.get(column);
    const current = row[column] ?? null;
    if (String(previous ?? "") !== String(current ?? "")) state.unstable.add(column);
  }
}
function ensureEndpointCount(internals, row, sequence) {
  const key = String(row.ENA_UNIT ?? mergeColumns(row, internals.units));
  let accumulator = internals.endpointCounts.get(key);
  if (!accumulator) {
    accumulator = {
      row: {
        ...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
        ENA_UNIT: key
      },
      sums: zeros2(internals.codeColumns.length),
      sequence
    };
    internals.endpointCounts.set(key, accumulator);
    internals.endpointOrder.push(key);
  }
  return accumulator;
}
function ensureStepCount(internals, row, sequence) {
  const key = mergeColumns(row, [...internals.units, ...internals.conversation]);
  let accumulator = internals.stepCounts.get(key);
  if (!accumulator) {
    accumulator = {
      row: {
        ...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
        ...Object.fromEntries(internals.conversation.map((column) => [column, row[column] ?? null])),
        ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units),
        TRAJ_UNIT: mergeColumns(row, internals.conversation)
      },
      sums: zeros2(internals.codeColumns.length),
      sequence
    };
    internals.stepCounts.set(key, accumulator);
    internals.stepOrder.push(key);
  }
  return accumulator;
}
function addToAccumulator(accumulator, values2) {
  for (let index = 0; index < values2.length; index += 1) {
    accumulator.sums[index] = (accumulator.sums[index] ?? 0) + (values2[index] ?? 0);
  }
}
function consumeRowConnection(internals, index, row) {
  if (internals.materialization === "full") internals.rowConnectionRows.push({ index, row });
  const unit = String(row.ENA_UNIT ?? "");
  if (internals.unitFilter && !internals.unitFilter.has(unit)) return;
  const values2 = internals.codeColumns.map((column) => numeric(row, column));
  if (internals.model === "EndPoint") {
    addToAccumulator(ensureEndpointCount(internals, row, index), values2);
  } else {
    addToAccumulator(ensureStepCount(internals, row, index), values2);
  }
}
function makeNoForwardCoOccurrence(state, entry, internals) {
  const binary = internals.weightBy === "binary";
  const back = internals.windowSizeBack;
  if (back === 0 || back === 1) return coOccurrenceFromSums(entry.codeValues, void 0, binary);
  if (!Number.isFinite(back)) {
    const previous2 = state.noForwardRunningSum;
    const total = addVectors2(previous2, entry.codeValues);
    state.noForwardRunningSum = total;
    return coOccurrenceFromSums(total, previous2, binary);
  }
  const previousRows = state.noForwardHistory.slice(-Math.max(0, back - 1));
  const previous = sumCodeVectors(previousRows, internals.codes.length);
  state.noForwardHistory.push(entry.codeValues);
  while (state.noForwardHistory.length > back - 1) state.noForwardHistory.shift();
  return coOccurrenceFromSums(addVectors2(previous, entry.codeValues), previous, binary);
}
function rowsForLocalRange(state, earliest, last) {
  return state.buffer.filter((entry) => entry.localIndex >= earliest && entry.localIndex <= last).sort((left, right) => left.localIndex - right.localIndex).map((entry) => entry.codeValues);
}
function computeWindowCoOccurrence(state, rowIndex, final, internals) {
  const rowCount = state.rowsSeen;
  const back = internals.windowSizeBack;
  const forward = internals.windowSizeForward;
  const binary = internals.weightBy === "binary";
  const infiniteBack = !Number.isFinite(back);
  const infiniteForward = !Number.isFinite(forward);
  if (!final && (infiniteForward || rowIndex + forward >= rowCount)) return void 0;
  let earliest = 0;
  let last = rowIndex;
  if (infiniteBack) earliest = 0;
  else if (back === 0) earliest = rowIndex;
  else if (rowIndex - (back - 1) >= 0) earliest = rowIndex - (back - 1);
  if (infiniteForward || rowIndex + forward >= rowCount) last = rowCount - 1;
  else if (forward > 0 && rowIndex + forward <= rowCount - 1) last = rowIndex + forward;
  const currRows = rowsForLocalRange(state, earliest, last);
  if (currRows.length !== last - earliest + 1) return void 0;
  let co = vectorToUpperTriangle(sumCodeVectors(currRows, internals.codes.length));
  const currRowCount = currRows.length;
  if (currRowCount > 0 && back > 1 && rowIndex - 1 >= 0) {
    const headRows = currRowCount - 1 - forward;
    if (headRows > 0) {
      co = subtractVectors2(co, vectorToUpperTriangle(sumCodeVectors(currRows.slice(0, headRows), internals.codes.length)));
    }
  }
  if (currRowCount > 0 && forward > 0 && last <= rowCount - 1) {
    const tailRowsToUse = last - rowIndex;
    if (tailRowsToUse > 0) {
      co = subtractVectors2(co, vectorToUpperTriangle(sumCodeVectors(currRows.slice(-tailRowsToUse), internals.codes.length)));
    }
  }
  return binary ? co.map((value) => value > 0 ? 1 : 0) : co;
}
function emitReadyRows(state, final, internals) {
  while (state.nextEmitLocalIndex < state.rowsSeen) {
    const entry = state.buffer.find((candidate) => candidate.localIndex === state.nextEmitLocalIndex);
    if (!entry) break;
    const co = computeWindowCoOccurrence(state, state.nextEmitLocalIndex, final, internals);
    if (!co) break;
    consumeRowConnection(
      internals,
      entry.globalIndex,
      rowWithCoOccurrences(entry.row, finalizeCoOccurrence(co, internals), internals.codeColumns)
    );
    state.nextEmitLocalIndex += 1;
  }
  if (Number.isFinite(internals.windowSizeBack)) {
    const keepFrom = Math.max(0, state.nextEmitLocalIndex - Math.max(0, internals.windowSizeBack - 1));
    while (state.buffer.length > 0 && (state.buffer[0]?.localIndex ?? 0) < keepFrom) {
      state.buffer.shift();
      state.bufferOffset = keepFrom;
    }
  }
}
function getMovingConversation(internals, key) {
  let state = internals.movingConversations.get(key);
  if (!state) {
    state = {
      key,
      rowsSeen: 0,
      nextEmitLocalIndex: 0,
      bufferOffset: 0,
      buffer: [],
      noForwardHistory: [],
      noForwardRunningSum: zeros2(internals.codes.length)
    };
    internals.movingConversations.set(key, state);
  }
  return state;
}
function pushMovingRow(internals, row, globalIndex) {
  const key = mergeColumns(row, internals.conversation);
  const state = getMovingConversation(internals, key);
  const entry = {
    globalIndex,
    localIndex: state.rowsSeen,
    row,
    codeValues: codeValues(row, internals.codes)
  };
  state.rowsSeen += 1;
  if (internals.windowSizeForward === 0) {
    const co = makeNoForwardCoOccurrence(state, entry, internals);
    consumeRowConnection(
      internals,
      globalIndex,
      rowWithCoOccurrences(row, finalizeCoOccurrence(co, internals), internals.codeColumns)
    );
    return;
  }
  state.buffer.push(entry);
  emitReadyRows(state, false, internals);
}
function pushConversationRow(internals, row, sequence) {
  const key = mergeColumns(row, [...internals.conversation, "ENA_UNIT"]);
  let aggregate = internals.conversationAggregates.get(key);
  if (!aggregate) {
    aggregate = {
      key,
      row: {
        ...Object.fromEntries(internals.codes.map((code) => [code, 0])),
        ...Object.fromEntries(internals.conversation.map((column) => [column, row[column] ?? null])),
        ...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
        ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units)
      },
      sums: zeros2(internals.codes.length),
      sequence
    };
    internals.conversationAggregates.set(key, aggregate);
    internals.conversationAggregateOrder.push(key);
  }
  for (let index = 0; index < internals.codes.length; index += 1) {
    aggregate.sums[index] = (aggregate.sums[index] ?? 0) + numeric(row, internals.codes[index] ?? "");
  }
}
function flushConversationWindow(internals) {
  const binary = internals.weightBy === "binary";
  for (const key of internals.conversationAggregateOrder) {
    const aggregate = internals.conversationAggregates.get(key);
    if (!aggregate) continue;
    const co = coOccurrenceFromSums(aggregate.sums, void 0, binary);
    const row = {
      ...aggregate.row,
      ...Object.fromEntries(internals.codes.map((code, index) => [code, aggregate.sums[index] ?? 0]))
    };
    consumeRowConnection(
      internals,
      aggregate.sequence,
      rowWithCoOccurrences(row, finalizeCoOccurrence(co, internals), internals.codeColumns)
    );
  }
}
function stableMetadataColumns(internals) {
  if (!internals.includeMeta) return [];
  return internals.metadata.filter((column) => {
    for (const state of internals.metadataStates.values()) {
      if (state.unstable.has(column)) return false;
    }
    return true;
  });
}
function buildMetadataRows(internals, countUnits) {
  const stable = stableMetadataColumns(internals);
  return internals.metadataOrder.filter((unit) => countUnits.has(unit)).map((unit) => {
    const state = internals.metadataStates.get(unit);
    const base = state?.row ?? { ENA_UNIT: unit };
    return {
      ...base,
      ...Object.fromEntries(stable.map((column) => [column, state?.values.get(column) ?? null]))
    };
  });
}
function matrixFromRows(rows, columns) {
  return rows.map((row) => columns.map((column) => numeric(row, column)));
}
function makeEndpointResult(internals) {
  const countRows = internals.endpointOrder.map((key) => {
    const accumulator = internals.endpointCounts.get(key);
    return {
      ...accumulator?.row ?? { ENA_UNIT: key },
      ...Object.fromEntries(internals.codeColumns.map((column, index) => [column, accumulator?.sums[index] ?? 0]))
    };
  });
  const countUnits = new Set(countRows.map((row) => String(row.ENA_UNIT ?? "")));
  const metaData = buildMetadataRows(internals, countUnits);
  const metaByUnit = new Map(metaData.map((row) => [String(row.ENA_UNIT ?? ""), row]));
  return {
    countRows,
    metaData,
    connectionCounts: countRows.map((row) => ({
      ...metaByUnit.get(String(row.ENA_UNIT ?? "")) ?? {},
      ...Object.fromEntries(internals.codeColumns.map((column) => [column, row[column] ?? 0]))
    }))
  };
}
function makeTrajectoryRows(internals) {
  return internals.stepOrder.map((key) => {
    const accumulator = internals.stepCounts.get(key);
    return {
      ...accumulator?.row ?? {},
      ...Object.fromEntries(internals.codeColumns.map((column, index) => [column, accumulator?.sums[index] ?? 0]))
    };
  });
}
function makeTrajectoryResult(internals) {
  const perStepRows = makeTrajectoryRows(internals);
  const countRows = [];
  if (internals.model === "SeparateTrajectory") {
    countRows.push(...perStepRows);
  } else {
    const rowsByUnit = /* @__PURE__ */ new Map();
    for (const row of perStepRows) {
      const unit = String(row.ENA_UNIT ?? "");
      const current = rowsByUnit.get(unit);
      if (current) current.push(row);
      else rowsByUnit.set(unit, [row]);
    }
    for (const groupRows of rowsByUnit.values()) {
      const running = Object.fromEntries(internals.codeColumns.map((column) => [column, 0]));
      for (const row of groupRows) {
        for (const column of internals.codeColumns) running[column] = numeric(running, column) + numeric(row, column);
        countRows.push({ ...row, ...running });
      }
    }
  }
  const trajectories = countRows.map((row) => Object.fromEntries([...internals.units, "ENA_UNIT", ...internals.conversation].map((column) => [column, row[column] ?? null])));
  const metaData = countRows.map((row) => Object.fromEntries([...internals.units, "ENA_UNIT"].map((column) => [column, row[column] ?? null])));
  const connectionCounts = countRows.map((row) => ({
    ...Object.fromEntries(internals.units.map((column) => [column, row[column] ?? null])),
    ENA_UNIT: row.ENA_UNIT ?? mergeColumns(row, internals.units),
    ...Object.fromEntries(internals.codeColumns.map((column) => [column, row[column] ?? 0]))
  }));
  return { connectionCounts, metaData, countRows, trajectories };
}
function flushMovingWindow(internals) {
  if (internals.windowSizeForward === 0) return;
  for (const state of internals.movingConversations.values()) emitReadyRows(state, true, internals);
}
function finishInternals(internals) {
  if (internals.window === "Conversation") flushConversationWindow(internals);
  else flushMovingWindow(internals);
  const resultRows = internals.model === "EndPoint" ? makeEndpointResult(internals) : makeTrajectoryResult(internals);
  const connectionMatrix = matrixFromRows(resultRows.connectionCounts, internals.codeColumns);
  const unitLabels = resultRows.countRows.map((row) => internals.model === "EndPoint" ? String(row.ENA_UNIT ?? "") : `${String(row.ENA_UNIT ?? "")}::${String(row.TRAJ_UNIT ?? "")}`);
  const rowConnectionCounts = internals.materialization === "full" ? internals.rowConnectionRows.sort((left, right) => left.index - right.index).map((entry) => entry.row) : [];
  const rawRows = internals.materialization === "full" ? internals.rawRows : [];
  const result = {
    modelType: internals.model,
    codes: internals.codes,
    units: internals.units,
    conversation: internals.conversation,
    codeColumns: internals.codeColumns,
    adjacencyKey: adjacencyKey(internals.codes),
    rawRows,
    rowConnectionCounts,
    connectionCounts: resultRows.connectionCounts,
    connectionMatrix,
    metaData: resultRows.metaData,
    unitLabels,
    functionParams: {
      model: internals.model,
      weightBy: internals.weightBy,
      window: internals.window,
      windowSizeBack: internals.windowSizeBack,
      windowSizeForward: internals.windowSizeForward,
      includeMeta: internals.includeMeta,
      ...internals.unitFilter ? { unitsUsed: [...internals.unitFilter] } : {}
    }
  };
  const trajectoryRows = resultRows.trajectories;
  if (trajectoryRows) result.trajectories = trajectoryRows;
  return result;
}
function activeBufferedRows(internals) {
  let total = 0;
  for (const state of internals.movingConversations.values()) {
    total += state.buffer.length + state.noForwardHistory.length;
  }
  return total;
}
function updateProgress(state, internals, expectedRows) {
  state.progress = expectedRows && expectedRows > 0 ? Math.min(0.99, state.rowsSeen / expectedRows) : 0;
  state.activeConversations = internals.movingConversations.size + internals.conversationAggregates.size;
  state.activeBufferedRows = activeBufferedRows(internals);
  state.activeConversationsPeak = Math.max(state.activeConversationsPeak, state.activeConversations);
  state.activeBufferedRowsPeak = Math.max(state.activeBufferedRowsPeak, state.activeBufferedRows);
}
function makeInternals(options) {
  const model = normalizeModel(options.model);
  const window = normalizeWindow(options.window);
  const weightBy = normalizeWeightBy(options.weightBy);
  const metadata = options.metadata ?? [];
  assertNonEmptyColumns(options.units, "units");
  assertNonEmptyColumns(options.conversation, "conversation");
  assertNonEmptyColumns(options.codes, "codes");
  if (options.rows) assertRowsHaveColumns(options.rows, [...options.units, ...options.conversation, ...options.codes, ...metadata]);
  return {
    model,
    window,
    weightBy,
    windowSizeBack: window === "Conversation" ? Number.POSITIVE_INFINITY : options.windowSizeBack ?? 1,
    windowSizeForward: options.windowSizeForward ?? 0,
    includeMeta: options.includeMeta ?? true,
    materialization: options.materialization ?? "full",
    units: options.units,
    conversation: options.conversation,
    codes: options.codes,
    metadata,
    codeColumns: stringVectorToUpperTriangle(options.codes),
    ...options.mask ? { mask: options.mask } : {},
    ...options.unitsUsed ? { unitFilter: new Set(options.unitsUsed.map(String)) } : {},
    rawRows: [],
    rowConnectionRows: [],
    movingConversations: /* @__PURE__ */ new Map(),
    conversationAggregates: /* @__PURE__ */ new Map(),
    conversationAggregateOrder: [],
    endpointCounts: /* @__PURE__ */ new Map(),
    endpointOrder: [],
    stepCounts: /* @__PURE__ */ new Map(),
    stepOrder: [],
    metadataStates: /* @__PURE__ */ new Map(),
    metadataOrder: [],
    rowConnectionSequence: 0
  };
}
function ingestRow(internals, row, globalIndex) {
  const rowWithUnit = makeUnitRow(row, internals.units);
  if (internals.materialization === "full") internals.rawRows.push(rowWithUnit);
  ensureMetadata(internals, rowWithUnit, globalIndex);
  if (internals.window === "Conversation") pushConversationRow(internals, rowWithUnit, internals.rowConnectionSequence);
  else pushMovingRow(internals, rowWithUnit, globalIndex);
  internals.rowConnectionSequence += 1;
}
function accumulateDataChunked(options) {
  const chunkSize = options.chunkSize ?? 1e4;
  if (chunkSize <= 0 || !Number.isFinite(chunkSize)) throw new Error("chunkSize must be a positive finite number.");
  options.onProgress?.(0);
  const stream = createAccumulationStream({
    ...options,
    rows: [],
    expectedRows: options.rows.length,
    onProgress: (progress) => options.onProgress?.(progress)
  });
  for (let index = 0; index < options.rows.length; index += chunkSize) {
    stream.push(options.rows.slice(index, index + chunkSize));
  }
  const result = stream.finish();
  options.onProgress?.(1);
  return result;
}
function createAccumulationStream(options) {
  const { rows: initialRows, chunkSize = 1e4, expectedRows, onProgress } = options;
  if (chunkSize <= 0 || !Number.isFinite(chunkSize)) throw new Error("chunkSize must be a positive finite number.");
  const internals = makeInternals(options);
  const state = {
    rowsSeen: 0,
    chunksSeen: 0,
    isFinished: false,
    progress: 0,
    activeConversations: 0,
    activeBufferedRows: 0,
    activeConversationsPeak: 0,
    activeBufferedRowsPeak: 0
  };
  const push = (rows) => {
    if (state.isFinished) throw new Error("Cannot push rows after accumulation stream has finished.");
    assertRowsHaveColumns(rows, [...options.units, ...options.conversation, ...options.codes, ...options.metadata ?? []]);
    for (const row of rows) {
      ingestRow(internals, row, state.rowsSeen);
      state.rowsSeen += 1;
    }
    state.chunksSeen += 1;
    updateProgress(state, internals, expectedRows);
    onProgress?.(state.progress, { ...state });
    return { ...state };
  };
  if (initialRows && initialRows.length > 0) {
    for (let index = 0; index < initialRows.length; index += chunkSize) push(initialRows.slice(index, index + chunkSize));
  }
  return {
    state,
    push,
    finish() {
      if (state.isFinished) throw new Error("Accumulation stream has already finished.");
      state.isFinished = true;
      const result = finishInternals(internals);
      state.progress = 1;
      updateProgress(state, internals, expectedRows);
      state.progress = 1;
      onProgress?.(1, { ...state });
      return result;
    },
    reset() {
      throw new Error("Reset is not supported for incremental accumulation streams. Create a new stream instead.");
    }
  };
}
function accumulateDataStreaming(options) {
  const stream = createAccumulationStream(options);
  return stream.finish();
}

// src/stats.ts
function dimensionNames(set, dims) {
  if (!dims) return set.rotation.rotationColumns.slice(0, 2);
  return dims.map((dim) => typeof dim === "number" ? set.rotation.rotationColumns[dim - 1] ?? `Dimension${dim}` : dim);
}
function values(rows, column) {
  return rows.map((row) => {
    const value = Number(row[column] ?? 0);
    return Number.isFinite(value) ? value : 0;
  });
}
function ranks(input) {
  const sorted = input.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const out = Array.from({ length: input.length }, () => 0);
  let cursor = 0;
  while (cursor < sorted.length) {
    let end = cursor + 1;
    while (end < sorted.length && sorted[end]?.value === sorted[cursor]?.value) end += 1;
    const rank = (cursor + 1 + end) / 2;
    for (let i = cursor; i < end; i += 1) {
      const index = sorted[i]?.index ?? 0;
      out[index] = rank;
    }
    cursor = end;
  }
  return out;
}
function inverseNormal(p) {
  if (p <= 0 || p >= 1) return Number.NaN;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const plow = 0.02425;
  const phigh = 1 - plow;
  const horner = (coefficients, x) => coefficients.reduce((total, coefficient) => total * x + coefficient, 0);
  if (p < plow) {
    const q2 = Math.sqrt(-2 * Math.log(p));
    const numerator2 = horner(c, q2);
    const denominator2 = horner(d, q2) * q2 + 1;
    return numerator2 / denominator2;
  }
  if (p > phigh) {
    const q2 = Math.sqrt(-2 * Math.log(1 - p));
    const numerator2 = horner(c, q2);
    const denominator2 = horner(d, q2) * q2 + 1;
    return -numerator2 / denominator2;
  }
  const q = p - 0.5;
  const r = q * q;
  const numerator = horner(a, r) * q;
  const denominator = horner(b, r) * r + 1;
  return numerator / denominator;
}
function confidenceInterval(r, n, confLevel) {
  if (!Number.isFinite(r) || n <= 3) return [Number.NaN, Number.NaN];
  const z = Math.atanh(Math.max(-0.999999999999, Math.min(0.999999999999, r)));
  const sigma = 1 / Math.sqrt(n - 3);
  const q = inverseNormal((1 + confLevel) / 2);
  return [Math.tanh(z - sigma * q), Math.tanh(z + sigma * q)];
}
function finiteValues(rows, column) {
  return values(rows, column).filter(Number.isFinite);
}
function mean(input) {
  return input.length === 0 ? Number.NaN : input.reduce((sum, value) => sum + value, 0) / input.length;
}
function sampleVariance(input) {
  if (input.length < 2) return Number.NaN;
  const avg = mean(input);
  return input.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (input.length - 1);
}
function groupedPointValues(set, by, dimension) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of set.points) {
    const key = String(row[by] ?? null);
    const current = groups.get(key) ?? [];
    current.push(Number(row[dimension] ?? 0));
    groups.set(key, current);
  }
  return groups;
}
function welchTTest(dimension, groups) {
  const [left, right] = groups;
  if (!left || !right || groups.length !== 2) return void 0;
  const leftMean = mean(left[1]);
  const rightMean = mean(right[1]);
  const leftVariance = sampleVariance(left[1]);
  const rightVariance = sampleVariance(right[1]);
  const leftTerm = leftVariance / left[1].length;
  const rightTerm = rightVariance / right[1].length;
  const denominator = Math.sqrt(leftTerm + rightTerm);
  const statistic = denominator === 0 ? Number.NaN : (leftMean - rightMean) / denominator;
  const dfNumerator = Math.pow(leftTerm + rightTerm, 2);
  const dfDenominator = Math.pow(leftTerm, 2) / (left[1].length - 1) + Math.pow(rightTerm, 2) / (right[1].length - 1);
  return {
    dimension,
    test: "welch-t",
    groups: [left[0], right[0]],
    statistic,
    df: dfDenominator === 0 ? Number.NaN : dfNumerator / dfDenominator
  };
}
function oneWayAnova(dimension, groups) {
  const populated = groups.filter((entry) => entry[1].length > 0);
  if (populated.length < 2) return void 0;
  const all = populated.flatMap((entry) => entry[1]);
  const overallMean = mean(all);
  const between = populated.reduce((sum, entry) => sum + entry[1].length * Math.pow(mean(entry[1]) - overallMean, 2), 0);
  const within = populated.reduce((sum, entry) => {
    const groupMean = mean(entry[1]);
    return sum + entry[1].reduce((inner, value) => inner + Math.pow(value - groupMean, 2), 0);
  }, 0);
  const dfBetween = populated.length - 1;
  const dfWithin = all.length - populated.length;
  const statistic = dfWithin <= 0 || within === 0 ? Number.NaN : between / dfBetween / (within / dfWithin);
  return {
    dimension,
    test: "one-way-anova",
    groups: populated.map((entry) => entry[0]),
    statistic,
    dfBetween,
    dfWithin
  };
}
function enaCorrelations(set, dims, confLevel = 0.95) {
  if (!set.centroids) throw new Error("ENA set does not include centroids.");
  const names = dimensionNames(set, dims);
  const pairs = [];
  for (let i = 0; i < set.points.length; i += 1) {
    for (let j = i + 1; j < set.points.length; j += 1) pairs.push([i, j]);
  }
  return names.map((dimension) => {
    const pointValues = values(set.points, dimension);
    const centroidValues = values(set.centroids ?? [], dimension);
    const pointDiff = pairs.map(([left, right]) => (pointValues[left] ?? 0) - (pointValues[right] ?? 0));
    const centroidDiff = pairs.map(([left, right]) => (centroidValues[left] ?? 0) - (centroidValues[right] ?? 0));
    const pearson = pearsonCorrelation(pointDiff, centroidDiff);
    const spearman = pearsonCorrelation(ranks(pointDiff), ranks(centroidDiff));
    const [pearsonLower, pearsonUpper] = confidenceInterval(pearson, pairs.length, confLevel);
    return { dimension, pearson, spearman, pearsonLower, pearsonUpper };
  });
}
function cohensD2(x, y) {
  return cohensD(x, y);
}
function dimensionSummary(set, dims) {
  return dimensionNames(set, dims).map((dimension) => {
    const vals = finiteValues(set.points, dimension);
    const variance = sampleVariance(vals);
    return {
      dimension,
      n: vals.length,
      mean: mean(vals),
      sd: Math.sqrt(variance),
      variance,
      min: vals.length === 0 ? Number.NaN : Math.min(...vals),
      max: vals.length === 0 ? Number.NaN : Math.max(...vals)
    };
  });
}
function groupSummary(set, by, dims) {
  const names = dimensionNames(set, dims);
  const groups = /* @__PURE__ */ new Map();
  for (const row of set.points) {
    const key = String(row[by] ?? null);
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()].map(([group, rows]) => ({
    group,
    n: rows.length,
    means: Object.fromEntries(names.map((dimension) => {
      const vals = values(rows, dimension);
      return [dimension, vals.reduce((sum, value) => sum + value, 0) / vals.length];
    }))
  }));
}
function enaStats(set, options = {}) {
  const dimensions = dimensionSummary(set, options.dims);
  const correlations = enaCorrelations(set, options.dims, options.confLevel ?? 0.95);
  if (!options.by) return { dimensions, correlations };
  const groups = groupSummary(set, options.by, options.dims);
  const tests = dimensionNames(set, options.dims).flatMap((dimension) => {
    const grouped = [...groupedPointValues(set, options.by ?? "", dimension).entries()];
    const test = grouped.length === 2 ? welchTTest(dimension, grouped) : oneWayAnova(dimension, grouped);
    return test ? [test] : [];
  });
  return { dimensions, correlations, groups, tests };
}
export {
  accumulateData,
  accumulateDataChunked,
  accumulateDataStreaming,
  addGroup,
  addMergedColumn,
  addNetwork,
  addNodes,
  addPoints,
  addTrajectory,
  addVectors,
  adjacencyKey,
  assertFiniteNumbers,
  assertNonEmptyColumns,
  assertRectangularMatrix,
  assertRowsHaveColumns,
  centerData,
  centroidsAsRows,
  cloneMatrix,
  cohensD2 as cohensD,
  combnC2,
  covarianceLike,
  createAccumulationStream,
  createENAPlotModel,
  createENAWorkerClient,
  deflateMatrix,
  designSolve,
  dimensionSummary,
  directedNodePositions,
  directedNodePositionsWithGroundResponseAdded,
  dot,
  elasticNet,
  elasticNetCV,
  ena,
  enaCorrelations,
  enaStats,
  gramSchmidtComplete,
  groupBy,
  groupSummary,
  identity,
  l2Norm,
  lwsLeastSquaresPositions,
  makeSet,
  matrixAdd,
  matrixSubtract,
  meanColumns,
  mergeColumns,
  multiplyMatrices,
  multiplyMatrixVector,
  networkFromConnectionRow,
  nodesAsRows,
  normalizeVector,
  numericRowFromColumns,
  outerProduct,
  pearsonCorrelation,
  projectIn,
  projectRotation,
  refWindowLag,
  refWindowMatrix,
  renderENAPlot,
  residualMatrix,
  rotateByGeneralized,
  rotateByHena,
  rotateByMean,
  rotateByRegression,
  rotateByRegression2,
  rotateBySpherical,
  rowsToCoOccurrences,
  rowsToCoOccurrencesTyped,
  rowsToNumericTable,
  rowsWithNumericColumns,
  scalarToString,
  scalePlot,
  scaleVector,
  selectColumns,
  skipSphereNorm,
  solveLinearSystem,
  sphereNorm,
  stringVectorToUpperTriangle,
  subtractOuterProjection,
  subtractVectors,
  sumColumns,
  sumRowsBy,
  svdRotation,
  symmetricJacobiEigen,
  toNumericMatrix,
  toPlotly,
  transpose,
  triIndices,
  uniqueRows,
  varianceColumns,
  vectorToUpperTriangle,
  zeros
};
//# sourceMappingURL=index.js.map