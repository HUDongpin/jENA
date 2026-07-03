// src/core/guards.ts
function assertNonEmptyColumns(columns, label) {
  if (columns.length === 0) {
    throw new Error(`${label} must contain at least one column name.`);
  }
}
function assertRowsHaveColumns(rows, columns, label = "rows") {
  const missing = /* @__PURE__ */ new Set();
  for (const row of rows) {
    for (const column of columns) {
      if (!(column in row)) missing.add(column);
    }
  }
  if (missing.size > 0) {
    throw new Error(`${label} are missing required columns: ${[...missing].join(", ")}`);
  }
}
function assertRectangularMatrix(matrix, label = "matrix") {
  if (matrix.length === 0) return;
  const width = matrix[0]?.length ?? 0;
  for (let i = 0; i < matrix.length; i += 1) {
    if ((matrix[i]?.length ?? 0) !== width) {
      throw new Error(`${label} must be rectangular; row ${i} has a different width.`);
    }
  }
}
function assertFiniteNumbers(matrix, label = "matrix") {
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < (matrix[row]?.length ?? 0); col += 1) {
      const value = matrix[row]?.[col];
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`${label}[${row}][${col}] must be a number, got ${String(value)}.`);
      }
    }
  }
}

// src/core/matrix.ts
function cloneMatrix(matrix) {
  return matrix.map((row) => [...row]);
}
function zeros(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
}
function combnC2(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("n must be a non-negative integer.");
  const out = [[], []];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      out[0]?.push(i);
      out[1]?.push(j);
    }
  }
  return out;
}
function triIndices(length, row = -1) {
  if (!Number.isInteger(length) || length < 0) throw new Error("length must be a non-negative integer.");
  const first = [];
  const second = [];
  for (let i = 1; i < length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      first.push(j);
      second.push(i);
    }
  }
  if (row === 0) return [first];
  if (row === 1) return [second];
  return [first, second];
}
function adjacencyKey(codes) {
  const indices = triIndices(codes.length);
  const sources = indices[0] ?? [];
  const targets = indices[1] ?? [];
  return sources.map((sourceIndex, i) => {
    const targetIndex = targets[i] ?? 0;
    const source = codes[sourceIndex] ?? String(sourceIndex);
    const target = codes[targetIndex] ?? String(targetIndex);
    return {
      source,
      target,
      name: `${source} & ${target}`,
      sourceIndex,
      targetIndex
    };
  });
}
function vectorToUpperTriangle(vector) {
  const out = [];
  for (let i = 1; i < vector.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      out.push((vector[j] ?? 0) * (vector[i] ?? 0));
    }
  }
  return out;
}
function stringVectorToUpperTriangle(values) {
  const out = [];
  for (let i = 1; i < values.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      out.push(`${values[j] ?? ""} & ${values[i] ?? ""}`);
    }
  }
  return out;
}
function rowsToCoOccurrences(matrix, binary = true) {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  return matrix.map((row) => {
    const co = vectorToUpperTriangle(row);
    return binary ? co.map((value) => value > 0 ? 1 : 0) : co;
  });
}
function sumColumns(matrix) {
  if (matrix.length === 0) return [];
  const width = matrix[0]?.length ?? 0;
  const sums = Array.from({ length: width }, () => 0);
  for (const row of matrix) {
    for (let col = 0; col < width; col += 1) {
      sums[col] = (sums[col] ?? 0) + (row[col] ?? 0);
    }
  }
  return sums;
}
function meanColumns(matrix) {
  if (matrix.length === 0) return [];
  const sums = sumColumns(matrix);
  return sums.map((sum) => sum / matrix.length);
}
function subtractVectors(a, b) {
  const length = Math.max(a.length, b.length);
  return Array.from({ length }, (_, i) => (a[i] ?? 0) - (b[i] ?? 0));
}
function addVectors(a, b) {
  const length = Math.max(a.length, b.length);
  return Array.from({ length }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
}
function scaleVector(vector, scalar) {
  return vector.map((value) => value * scalar);
}
function dot(a, b) {
  const length = Math.max(a.length, b.length);
  let total = 0;
  for (let i = 0; i < length; i += 1) total += (a[i] ?? 0) * (b[i] ?? 0);
  return total;
}
function l2Norm(vector) {
  return Math.sqrt(dot(vector, vector));
}
function refWindowMatrix(matrix, windowSize = 1, windowForward = 0, binary = true) {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  const rowCount = matrix.length;
  const out = [];
  const infiniteBack = !Number.isFinite(windowSize);
  const infiniteForward = !Number.isFinite(windowForward);
  for (let row = 0; row < rowCount; row += 1) {
    let earliestRow = 0;
    let lastRow = row;
    if (infiniteBack) {
      earliestRow = 0;
    } else if (windowSize === 0) {
      earliestRow = row;
    } else if (row - (windowSize - 1) >= 0) {
      earliestRow = row - (windowSize - 1);
    }
    if (infiniteForward || row + windowForward >= rowCount) {
      lastRow = rowCount - 1;
    } else if (windowForward > 0 && row + windowForward <= rowCount - 1) {
      lastRow = row + windowForward;
    }
    const currRows = matrix.slice(earliestRow, lastRow + 1);
    let co = vectorToUpperTriangle(sumColumns(currRows));
    const currRowCount = currRows.length;
    if (currRowCount > 0 && windowSize > 1 && row - 1 >= 0) {
      const headRows = Math.max(0, currRowCount - 1 - windowForward);
      if (headRows > 0) {
        co = subtractVectors(co, vectorToUpperTriangle(sumColumns(currRows.slice(0, headRows))));
      }
    }
    if (currRowCount > 0 && windowForward > 0 && lastRow <= rowCount - 1) {
      const tailRowsToUse = lastRow - row;
      if (tailRowsToUse > 0) {
        co = subtractVectors(co, vectorToUpperTriangle(sumColumns(currRows.slice(-tailRowsToUse))));
      }
    }
    out.push(binary ? co.map((value) => value > 0 ? 1 : 0) : co);
  }
  return out;
}
function refWindowLag(matrix, windowSize = 0) {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  const out = [];
  for (let row = 0; row < matrix.length; row += 1) {
    const start = Math.max(0, row - (windowSize - 1));
    out.push(sumColumns(matrix.slice(start, row + 1)));
  }
  return out;
}
function sphereNorm(matrix) {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  return matrix.map((row) => {
    const norm = l2Norm(row);
    return norm > 0 ? row.map((value) => value / norm) : row.map(() => 0);
  });
}
function skipSphereNorm(matrix) {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  const largest = matrix.reduce((max, row) => Math.max(max, l2Norm(row)), 0);
  if (largest === 0) return matrix.map((row) => row.map(() => 0));
  return matrix.map((row) => row.map((value) => value / largest));
}
function centerData(matrix, centerVector = meanColumns(matrix)) {
  assertRectangularMatrix(matrix);
  assertFiniteNumbers(matrix);
  return matrix.map((row) => row.map((value, columnIndex) => value - (centerVector[columnIndex] ?? 0)));
}
function transpose(matrix) {
  if (matrix.length === 0) return [];
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const out = zeros(cols, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const outRow = out[col];
      if (outRow) outRow[row] = matrix[row]?.[col] ?? 0;
    }
  }
  return out;
}
function multiplyMatrices(a, b) {
  assertRectangularMatrix(a, "a");
  assertRectangularMatrix(b, "b");
  const aRows = a.length;
  const aCols = a[0]?.length ?? 0;
  const bRows = b.length;
  const bCols = b[0]?.length ?? 0;
  if (aCols !== bRows) throw new Error(`Matrix dimensions do not align: ${aRows}x${aCols} times ${bRows}x${bCols}.`);
  const out = zeros(aRows, bCols);
  for (let i = 0; i < aRows; i += 1) {
    for (let j = 0; j < bCols; j += 1) {
      let total = 0;
      for (let k = 0; k < aCols; k += 1) total += (a[i]?.[k] ?? 0) * (b[k]?.[j] ?? 0);
      const outRow = out[i];
      if (outRow) outRow[j] = total;
    }
  }
  return out;
}
function varianceColumns(matrix) {
  if (matrix.length < 2) return (matrix[0] ?? []).map(() => 0);
  const means = meanColumns(matrix);
  const sums = Array.from({ length: means.length }, () => 0);
  for (const row of matrix) {
    for (let col = 0; col < means.length; col += 1) {
      sums[col] = (sums[col] ?? 0) + Math.pow((row[col] ?? 0) - (means[col] ?? 0), 2);
    }
  }
  return sums.map((sum) => sum / (matrix.length - 1));
}
function pearsonCorrelation(a, b) {
  if (a.length !== b.length) throw new Error("Vectors must have equal length.");
  if (a.length < 2) return Number.NaN;
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = (a[i] ?? 0) - meanA;
    const db = (b[i] ?? 0) - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? Number.NaN : numerator / denom;
}
function cohensD(x, y) {
  const lx = x.length - 1;
  const ly = y.length - 1;
  if (lx <= 0 || ly <= 0) return Number.NaN;
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = (values) => {
    const m = mean(values);
    return values.reduce((sum, value) => sum + Math.pow(value - m, 2), 0) / (values.length - 1);
  };
  const common = Math.sqrt((lx * variance(x) + ly * variance(y)) / (lx + ly));
  return Math.abs(mean(x) - mean(y)) / common;
}

// src/core/table.ts
function scalarToString(value) {
  return value === null ? "" : String(value);
}
function mergeColumns(row, columns, separator = "::") {
  return columns.map((column) => scalarToString(row[column] ?? null)).join(separator);
}
function addMergedColumn(rows, outputColumn, columns, separator = "::") {
  assertRowsHaveColumns(rows, columns);
  return rows.map((row) => ({ ...row, [outputColumn]: mergeColumns(row, columns, separator) }));
}
function selectColumns(rows, columns) {
  assertRowsHaveColumns(rows, columns);
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
}
function toNumericMatrix(rows, columns) {
  assertRowsHaveColumns(rows, columns);
  return rows.map((row, rowIndex) => columns.map((column) => {
    const raw = row[column];
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Column ${column} at row ${rowIndex} must be numeric, got ${String(raw)}.`);
    }
    return value;
  }));
}
function groupBy(rows, keyFn) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}
function uniqueRows(rows, keyColumns) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const row of rows) {
    const key = mergeColumns(row, keyColumns);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(Object.fromEntries(keyColumns.map((column) => [column, row[column] ?? null])));
    }
  }
  return out;
}
function numericRowFromColumns(row, columns) {
  return columns.map((column) => {
    const raw = row[column];
    const value = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`Column ${column} must be numeric, got ${String(raw)}.`);
    }
    return value;
  });
}
function rowsWithNumericColumns(rows, columns, matrix) {
  if (rows.length !== matrix.length) {
    throw new Error(`Row count mismatch: ${rows.length} rows and ${matrix.length} matrix rows.`);
  }
  return rows.map((row, rowIndex) => {
    const next = { ...row };
    columns.forEach((column, columnIndex) => {
      next[column] = matrix[rowIndex]?.[columnIndex] ?? 0;
    });
    return next;
  });
}
function sumRowsBy(rows, keyColumns, valueColumns) {
  const grouped = groupBy(rows, (row) => mergeColumns(row, keyColumns));
  const out = [];
  for (const groupRows of grouped.values()) {
    const first = groupRows[0];
    if (!first) continue;
    const next = Object.fromEntries(keyColumns.map((column) => [column, first[column] ?? null]));
    for (const column of valueColumns) {
      next[column] = groupRows.reduce((sum, row) => {
        const raw = row[column];
        const value = typeof raw === "number" ? raw : Number(raw);
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0);
    }
    out.push(next);
  }
  return out;
}

// src/core/matrix-extra.ts
function identity(n) {
  return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_unused, col) => row === col ? 1 : 0));
}

// src/core/linear.ts
function solveLinearSystem(a, b, ridge = 1e-10) {
  const n = a.length;
  const aug = a.map((row, i) => row.map((value, j) => value + (i === j ? ridge : 0)).concat(b[i] ?? 0));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(aug[row]?.[col] ?? 0) > Math.abs(aug[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = aug[pivot];
    const currentRow = aug[col];
    if (!pivotRow || !currentRow) throw new Error("Invalid augmented matrix.");
    if (Math.abs(pivotRow[col] ?? 0) < 1e-14) continue;
    aug[pivot] = currentRow;
    aug[col] = pivotRow;
    const divisor = aug[col]?.[col] ?? 1;
    for (let j = col; j <= n; j += 1) {
      const row = aug[col];
      if (row) row[j] = (row[j] ?? 0) / divisor;
    }
    for (let rowIndex = 0; rowIndex < n; rowIndex += 1) {
      if (rowIndex === col) continue;
      const factor = aug[rowIndex]?.[col] ?? 0;
      for (let j = col; j <= n; j += 1) {
        const row = aug[rowIndex];
        if (row) row[j] = (row[j] ?? 0) - factor * (aug[col]?.[j] ?? 0);
      }
    }
  }
  return aug.map((row) => row[n] ?? 0);
}
function multiplyMatrixVector(matrix, vector) {
  return matrix.map((row) => dot(row, vector));
}
function normalizeVector(vector) {
  const norm = l2Norm(vector);
  return norm > 0 ? vector.map((value) => value / norm) : vector.map(() => 0);
}
function outerProduct(a, b) {
  return a.map((left) => b.map((right) => left * right));
}
function subtractOuterProjection(matrix, vector) {
  const unit = normalizeVector(vector);
  return matrix.map((row) => {
    const projection = dot(row, unit);
    return subtractVectors(row, scaleVector(unit, projection));
  });
}
function matrixSubtract(a, b) {
  return a.map((row, rowIndex) => row.map((value, colIndex) => value - (b[rowIndex]?.[colIndex] ?? 0)));
}
function matrixAdd(a, b) {
  return a.map((row, rowIndex) => row.map((value, colIndex) => value + (b[rowIndex]?.[colIndex] ?? 0)));
}
function gramSchmidtComplete(columns, dimension, tolerance = 1e-10) {
  const basisColumns = [];
  const candidateColumns = [
    ...columns,
    ...Array.from({ length: dimension }, (_unused, index) => Array.from({ length: dimension }, (_u, row) => row === index ? 1 : 0))
  ];
  for (const candidate of candidateColumns) {
    let vector = Array.from({ length: dimension }, (_unused, index) => candidate[index] ?? 0);
    for (const basis of basisColumns) {
      vector = subtractVectors(vector, scaleVector(basis, dot(vector, basis)));
    }
    const norm = l2Norm(vector);
    if (norm > tolerance) {
      basisColumns.push(vector.map((value) => value / norm));
    }
    if (basisColumns.length === dimension) break;
  }
  return Array.from({ length: dimension }, (_unused, row) => basisColumns.map((column) => column[row] ?? 0));
}
function designSolve(design, response, ridge = 1e-10) {
  const xt = transpose(design);
  const xtx = multiplyMatrices(xt, design);
  const xty = multiplyMatrices(xt, response);
  const cols = response[0]?.length ?? 0;
  const coefficientsByColumn = [];
  for (let col = 0; col < cols; col += 1) {
    coefficientsByColumn.push(solveLinearSystem(xtx, xty.map((row) => row[col] ?? 0), ridge));
  }
  return transpose(coefficientsByColumn);
}
function symmetricJacobiEigen(input, maxIterations = Math.max(200, input.length * input.length * 20), tolerance = 1e-12) {
  const n = input.length;
  const a = cloneMatrix(input);
  let v = identity(n);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let p = 0;
    let q = 1;
    let max = 0;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const value = Math.abs(a[i]?.[j] ?? 0);
        if (value > max) {
          max = value;
          p = i;
          q = j;
        }
      }
    }
    if (max < tolerance || n < 2) break;
    const app = a[p]?.[p] ?? 0;
    const aqq = a[q]?.[q] ?? 0;
    const apq = a[p]?.[q] ?? 0;
    const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    for (let i = 0; i < n; i += 1) {
      const matrixRow = a[i];
      const aip = matrixRow?.[p] ?? 0;
      const aiq = matrixRow?.[q] ?? 0;
      if (matrixRow) {
        matrixRow[p] = c * aip - s * aiq;
        matrixRow[q] = s * aip + c * aiq;
      }
    }
    const rowP = a[p];
    const rowQ = a[q];
    for (let j = 0; j < n; j += 1) {
      const apj = rowP?.[j] ?? 0;
      const aqj = rowQ?.[j] ?? 0;
      if (rowP) rowP[j] = c * apj - s * aqj;
      if (rowQ) rowQ[j] = s * apj + c * aqj;
    }
    if (rowP) rowP[q] = 0;
    if (rowQ) rowQ[p] = 0;
    const rotation = identity(n);
    const rotationP = rotation[p];
    const rotationQ = rotation[q];
    if (rotationP) {
      rotationP[p] = c;
      rotationP[q] = s;
    }
    if (rotationQ) {
      rotationQ[p] = -s;
      rotationQ[q] = c;
    }
    v = multiplyMatrices(v, rotation);
  }
  const pairs = Array.from({ length: n }, (_, i) => ({ value: a[i]?.[i] ?? 0, index: i })).sort((left, right) => right.value - left.value);
  const eigenvalues = pairs.map((pair) => Math.max(0, pair.value));
  const eigenvectors = Array.from({ length: n }, (_, row) => pairs.map((pair) => v[row]?.[pair.index] ?? 0));
  return { eigenvalues, eigenvectors };
}
function covarianceLike(matrix) {
  if (matrix.length === 0) return [];
  return multiplyMatrices(transpose(matrix), matrix);
}

export {
  assertNonEmptyColumns,
  assertRowsHaveColumns,
  assertRectangularMatrix,
  assertFiniteNumbers,
  cloneMatrix,
  zeros,
  combnC2,
  triIndices,
  adjacencyKey,
  vectorToUpperTriangle,
  stringVectorToUpperTriangle,
  rowsToCoOccurrences,
  sumColumns,
  meanColumns,
  subtractVectors,
  addVectors,
  scaleVector,
  dot,
  l2Norm,
  refWindowMatrix,
  refWindowLag,
  sphereNorm,
  skipSphereNorm,
  centerData,
  transpose,
  multiplyMatrices,
  varianceColumns,
  pearsonCorrelation,
  cohensD,
  scalarToString,
  mergeColumns,
  addMergedColumn,
  selectColumns,
  toNumericMatrix,
  groupBy,
  uniqueRows,
  numericRowFromColumns,
  rowsWithNumericColumns,
  sumRowsBy,
  identity,
  solveLinearSystem,
  multiplyMatrixVector,
  normalizeVector,
  outerProduct,
  subtractOuterProjection,
  matrixSubtract,
  matrixAdd,
  gramSchmidtComplete,
  designSolve,
  symmetricJacobiEigen,
  covarianceLike
};
//# sourceMappingURL=chunk-CS2S5LAI.js.map