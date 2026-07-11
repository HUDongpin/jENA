# Numerical Notes

How jena-js computes ENA models, where it deliberately deviates from rENA's solvers, and the agreement bounds enforced by the golden parity tests (`tests/r-goldens.test.ts`, `tests/stats-parity.test.ts` against fixtures generated from rENA 0.3.1).

## Dimension signs are arbitrary

SVD/eigen decompositions determine each rotated dimension only up to sign. jena-js and rENA can legitimately return mirrored axes for the same model. Golden tests compare points, node positions, and rotation-matrix columns **up to a per-column sign**; downstream code must not attach meaning to the absolute sign of a dimension. This also flips the sign of signed group statistics (e.g. the Welch t statistic) relative to an rENA run — magnitudes match.

## Variance explained (rENA semantics)

`makeSet` projects the centered, sphere-normed line weights onto the **full** rotation matrix (rENA `ena.make.set.R`: `points.for.projection %*% rotation.matrix`) and reports `variance` as each rotated dimension's share of the total variance across **all** dimensions. Shares over the displayed 2 dimensions therefore do not sum to 1. Golden agreement: 1e-9 per dimension on every fixture configuration.

## SVD via covariance + Jacobi (vs prcomp/LAPACK)

rENA uses `prcomp` (LAPACK SVD of the data matrix). jena-js builds the Gram matrix XᵀX and diagonalizes it with a classical Jacobi eigensolver (`symmetricJacobiEigen`), iterating until the largest off-diagonal is at machine precision relative to the matrix scale. Squaring the condition number costs precision in principle; in practice golden points agree with rENA to ~1e-9 or better (tests enforce 5e-7 absolute). Computed eigenvalues are clamped at 0 to suppress −1e-30-scale rounding.

rENA's `prcomp(tol = 0)` drops exactly-zero components, so rENA may report fewer rotated dimensions than jena-js (which keeps all). Golden tests require rENA's columns to be a prefix of jena's and every extra jena dimension to carry a negligible (< 1e-9) variance share.

## Linear solves and node positions

`solveLinearSystem` applies an unconditional ridge of 1e-10 to the normal equations; rENA uses `arma::solve(..., equilibrate)`. On well-conditioned systems the difference is far below test tolerances. Node positions, however, solve `(WᵀW) x = Wᵀ points`, and on small models this system can be **singular** — rENA itself warns `solve(): system is singular; attempting approx solution` on the bundled fixtures. Both solvers then approximate the same minimum-norm solution, agreeing only to a few 1e-6 (golden bound: 4e-6 + 2e-6·|value|). Two consequences:

- Individual node coordinates on tiny/degenerate models are solver-sensitive at the 1e-6 level in both packages.
- **Centroids are robust**: `centroids = W · nodes`, and the null-space component that makes nodes ambiguous is annihilated by W, so centroids (and `enaCorrelations`, which consumes them) match rENA to 1e-9.

## Stats

- `cohensD` is the exact port of `rENA::fun_cohens.d` (absolute mean difference / pooled SD): 1e-9 agreement.
- `enaCorrelations` mirrors `rENA::ena.correlations` (Pearson/Spearman over all pairwise point/centroid differences): 1e-9 agreement. The confidence interval uses a Fisher-z construction with the pair count as n — rENA reports no CI; treat it as descriptive.
- `welchTTest` / `oneWayAnova` (via `enaStats`) match R's `t.test` statistic magnitude/df and `aov` F/df at 1e-9, but return **no p-values** — only statistics and degrees of freedom. Group order (and hence t sign) follows first appearance in the points table.
- `inverseNormal` is Acklam's rational approximation (relative error < 1.15e-9), tested against R `qnorm` at 1e-8.

## Experimental rotations

`generalized`, `regression`, `regression2`, `hena`, and `spherical` rotations are **not** golden-verified. Known structural deviations from rENA: the elastic-net solver is a hand-rolled coordinate-descent lasso with a fixed lambda grid and deterministic folds (rENA uses `glmnet` with randomized CV), and R model formulas are parsed by a simplified parser (`~`, `+`, `:` only — no `*`, `poly()`, or nested calls). Outputs are plausible-looking coordinates with no demonstrated relationship to rENA's; validate independently before research use.

## Golden test tolerances (summary)

| Quantity | Bound |
|---|---|
| Accumulation counts, line weights | 1e-12 |
| Projected points | 5e-7 absolute (observed ~1e-9 or better) |
| Node positions | 4e-6 + 2e-6·\|value\| (singular systems; see above) |
| Variance shares | 1e-9 |
| Rotation matrix columns (up to sign, non-negligible variance only) | 5e-7 |
| Correlations, Cohen's d, t/F statistics | 1e-9 |
| Normal quantiles | 1e-8 relative |
