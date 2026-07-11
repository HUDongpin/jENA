// Performance benchmarks with the advisory F-013 budgets. Run against the
// built package: npm run bench (builds first). Exits non-zero if any budget
// is exceeded, so CI catches large regressions; recorded baselines live in
// bench/BASELINES.md.
import { ena, enaCorrelations, symmetricJacobiEigen } from "../dist/index.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function time(label, budgetMs, run) {
  const start = performance.now();
  const detail = run();
  const elapsed = performance.now() - start;
  const ok = elapsed <= budgetMs;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${elapsed.toFixed(0)} ms (budget ${budgetMs} ms)${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const random = mulberry32(20260711);
const results = [];

// 1. Accumulation + full model: 20 codes x 5000 rows (E = 190 adjacency columns).
{
  const codes = Array.from({ length: 20 }, (_u, i) => `C${i}`);
  const rows = Array.from({ length: 5000 }, (_u, r) => ({
    unit: `u${r % 40}`,
    conv: `c${r % 25}`,
    ...Object.fromEntries(codes.map((code) => [code, random() < 0.25 ? 1 : 0]))
  }));
  results.push(time("ena() 20 codes x 5000 rows (accumulate + SVD model + nodes)", 2000, () => {
    const set = ena({ rows, units: ["unit"], conversation: ["conv"], codes, windowSizeBack: 4 });
    return `${set.points.length} points, ${set.rotation.rotationColumns.length} dims`;
  }));
}

// 2. Symmetric eigen at 190x190 (the covariance size for 20 codes).
{
  const n = 190;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      const value = random() - 0.5;
      matrix[i][j] = value;
      matrix[j][i] = value;
    }
  }
  results.push(time("symmetricJacobiEigen 190x190", 1000, () => {
    const eigen = symmetricJacobiEigen(matrix);
    return `top eigenvalue ${eigen.eigenvalues[0].toFixed(4)}`;
  }));
}

// 3. Correlations over 2000 units (~2M pairwise differences per dimension).
{
  const codes = ["A", "B", "C", "D", "E"];
  const rows = Array.from({ length: 4000 }, (_u, r) => ({
    unit: `u${r % 2000}`,
    conv: `c${r % 100}`,
    ...Object.fromEntries(codes.map((code) => [code, random() < 0.4 ? 1 : 0]))
  }));
  const set = ena({ rows, units: ["unit"], conversation: ["conv"], codes, windowSizeBack: 2 });
  results.push(time(`enaCorrelations over ${set.points.length} units`, 1000, () => {
    const correlations = enaCorrelations(set);
    return `pearson SVD1 ${correlations[0].pearson.toFixed(4)}`;
  }));
}

if (results.some((ok) => !ok)) {
  console.error("Benchmark budget exceeded.");
  process.exit(1);
}
console.log("All benchmarks within budget.");
