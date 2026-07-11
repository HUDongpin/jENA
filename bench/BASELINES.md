# Benchmark baselines

Run with `npm run bench` (builds first, then executes `scripts/bench.mjs`
against the built package). Budgets come from the 2026-07-08 advisory review
(F-013); the script exits non-zero when a budget is exceeded and runs in CI.

## 2026-07-11 — Apple M-series (aarch64-apple-darwin24), Node 24.15

| Scenario | Time | Budget |
|---|---|---|
| `ena()` 20 codes × 5000 rows (accumulate + SVD model + nodes) | 486 ms | 2000 ms |
| `symmetricJacobiEigen` 190×190 | 389 ms | 1000 ms |
| `enaCorrelations` over 2000 units (~2M pairs/dim) | 313 ms | 1000 ms |

Context: before the F-013 optimizations the 190×190 eigensolve took ~2991 ms
(classical max-pivot Jacobi) and the 2000-unit correlations ~3856 ms
(object-pair materialization + comparator sorts). Fixes: cyclic-by-row
Jacobi sweeps, flat mask vectors, typed-array difference vectors, and a
radix argsort for tie-averaged ranks.

## Practical scale guidance

- Codes: 20 codes = 190 adjacency dimensions is comfortably interactive;
  30 codes (435 dims) roughly cubes the eigensolve cost (~5 s) — consider
  the worker entry point for that scale.
- Correlations: pair count grows with units² (2000 units ≈ 2M pairs per
  dimension, ~0.3 s; 10 000 units ≈ 50M pairs, ~8 s and ~1.6 GB of typed
  buffers) — sample or batch beyond a few thousand units.
