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

## Regression and generalized rotations (verified)

`regression`, `regression2`, and single-covariate `generalized` rotations are golden-verified against `ena.rotate.by.hena.regression`, `ena.rotate.by.hena.regression_2`, and `ena.rotate.by.generalized` (12 configurations across three datasets, including x+y and multi-term formulas with interactions). Points, node positions, rotation-column names, and rotation-matrix columns match at the same tolerances as the SVD goldens. Faithfully ported rENA behaviors worth knowing:

- With string formulas, rENA cannot extract the predictor name, so the first regression axis is named after the first *adjacency column* (e.g. `A & B_reg`), and `regression2` axes are named `V_reg`. When x and y produce the same name, the second becomes `..._reg.1` (R `make.unique` semantics).
- rENA's y-direction regression is evaluated against the **original** points, not the x-deflated ones (its `with.ena.matrix` helper rebinds `V`), and the two leading axes are **not** orthogonalized against each other. jena reproduces both behaviors.
- Regression design solves are ridge-free (matching R's `lm`); only node positioning uses the 1e-10 ridge described above.
- `regression2` requires more units than adjacency columns; with fewer, R's `lm` returns NA coefficients and rENA errors — jena's validation of that case is the shared design-solve behavior.

**Variance-share caveat (rENA artifact):** rENA completes the rotation basis with `prcomp`, whose numerically-null trailing directions come from LAPACK's arbitrary null-space basis. Those directions can overlap the regression axis and silently absorb a real variance share (~5% on our research fixture), contaminating every reported share in a way that is not reproducible across BLAS implementations. jena instead keeps only directions genuinely spanned by the deflated data and completes the basis orthogonally, so null directions carry exactly zero variance and shares are well-defined. Golden tests therefore compare variance shares renormalized over the directions that carry variance on both sides; for SVD/mean rotations this reduces to the strict per-column check.

## hena rotation (verified, with upstream quirks)

`hena` is golden-verified against `ena.rotation.h` (6 configurations: x-only, x+y, factor-expanded controls, x·y interaction, centering on/off). Faithfully ported rENA behaviors worth knowing:

- Categorical x/y variables are dummy-coded with `data.table::rleidv` semantics — **run-length ids in row order**, so a value that re-appears after a different value starts a new group. This only behaves like a conventional dummy code when the rows are sorted by that variable; jena reproduces it exactly. Dummy-coded variables get an `_f` suffix in the rotation column names (`x_group_f`).
- Character control variables expand into lm-style treatment contrasts (one 0/1 column per sorted level after the first); the x·y interaction is the product of the (optionally centered) coded x and y.
- The y axis is orthogonalized against the x axis (unlike the regression rotations, which keep both raw).
- The `formula` override parameter was removed: the previous parser silently mis-parsed R formula syntax, and the advisory calls for loud rejection over silent mis-parsing. Use `xVar`/`yVar`/`controlVars`/`includeXY`.

## Multivariate elastic net (solver verified; CV deterministic by design)

The multi-covariate `generalized` rotation estimates the target's main effect with a multivariate elastic net, mirroring rENA's `get_x1_main_effect` (glmnet `family = "mgaussian"`: a group lasso across the response columns, internal predictor standardization, penalty factors rescaled to sum to the predictor count, unpenalized intercept). jena's `multiGaussianElasticNet` is **verified against glmnet at fixed lambda values to 1e-6** (four cases covering the gmr penalty shape, all-penalized, unstandardized, and α = 0.5 mixing; glmnet's own convergence tolerance, not jena's, sets the bound).

What cannot be verified: rENA selects lambda via `cv.glmnet`, which **randomizes fold assignment** — two rENA runs on the same data can pick different lambdas and produce different rotations. jena's `multiGaussianElasticNetCV` is deterministic instead: round-robin folds (row index mod nfolds) over a glmnet-style log-spaced lambda path. At equal lambda the two implementations agree; the selected lambda may legitimately differ from any particular rENA run. jena's fitted main effect excludes the intercept, matching rENA's `mm[, x1_cols] %*% x1_coefs`. One remaining design difference: rENA builds its design matrix with `model.matrix(~ .^2)` (all pairwise interactions, factor expansion); jena's simplified design uses the listed variables (with explicit `:` products) and numeric encodings.

## spherical rotation (jena extension)

`spherical` has **no rENA counterpart** (verified against the rENA 0.3.1 source). It anchors the first axis at a chosen adjacency direction (a co-occurrence column name or custom vector), orthogonalizes an optional secondary anchor against it, and completes the basis orthogonally. Its spec — anchor semantics, orthonormality, variance conservation — is locked by unit tests rather than rENA goldens.

## Custom weight functions (F-019, resolved)

Function-valued `weightBy` is applied once per windowed co-occurrence cell, BEFORE unit accumulation, receiving a single-element array. This matches rENA's runtime behavior exactly (golden-verified with a `sqrt` weighting on both datasets): rENA's implementation applies `weight.by` with `by = 1:nrow(...)`, so the function sees each row's cell as a length-1 vector — despite its docstring saying the function is applied "after accumulation" (a documentation bug, reported upstream). Consequently rENA's `weight.by = sum` is the identity on raw window products, which is what jena's `"sum"` string does. Cross-window aggregation semantics (e.g. `max` over a unit's windows) are deliberately NOT what `weightBy` means; if ever needed, that belongs to a new explicitly-named option.

## Formula parsing

R model formulas in the regression rotations are parsed by a simplified parser (`~`, `+`, `:` only — no `*`, `poly()`, or nested calls). Unsupported syntax is rejected loudly rather than mis-parsed.

## Golden test tolerances (summary)

| Quantity | Bound |
|---|---|
| Accumulation counts, line weights | 1e-12 |
| Projected points | 5e-7 absolute (observed ~1e-9 or better) |
| Node positions | 4e-6 + 2e-6·\|value\| (singular systems; see above) |
| Variance shares (renormalized over commonly-spanned directions) | 1e-9 |
| Rotation matrix columns (up to sign, commonly-spanned directions only) | 5e-7 |
| Correlations, Cohen's d, t/F statistics | 1e-9 |
| Normal quantiles | 1e-8 relative |
