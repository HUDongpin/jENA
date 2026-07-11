# Changelog

## 0.3.0 - 2026-07-11

### Verified

- **`regression`, `regression2`, and single-covariate `generalized` rotations are now golden-verified against rENA 0.3.1** (advisory F-002): 12 configurations across three datasets (x-only, x+y, multi-term formulas with interactions, `select2Groups`), asserting points, node positions, rotation-column names, rotation-matrix columns up to sign, and junk-aware variance shares. New `fixtures/goldens/rotations.generated.json` + `npm run goldens:rotations`.

### Fixed (parity with rENA)

- The y-direction of `regression`/`regression2` rotations is now computed from the **original** points, matching rENA's actual behavior (its `with.ena.matrix` rebinds `V`, shadowing the deflated copy), and the two leading axes are no longer re-orthogonalized (rENA keeps them raw).
- Rotation assembly completes the basis with the SVD of the deflated data like rENA, but keeps only genuinely-spanned directions and completes the remainder orthogonally to the data — avoiding an rENA artifact where LAPACK's arbitrary null-space basis absorbs a real variance share (~5% on the research fixture; see NUMERICS.md).
- `generalized` rotation's secondary axis (`x1`) now uses the unadjusted `lm(V ~ target)` fit (rENA's `Vx1`) rather than the covariate-adjusted effect.
- Regression design solves are ridge-free like R's `lm` (`designSolve` default ridge 0); node positioning keeps its documented 1e-10 ridge.
- Duplicate rotation column names (e.g. two `V_reg` axes) get R `make.unique` suffixes (`V_reg.1`) so point/node row keys cannot collide.

### Changed

- Golden variance assertions are junk-aware: shares are compared renormalized over directions that carry variance on both sides (identical to the previous strict check for SVD/mean rotations).
- `hena`, `spherical`, and multi-covariate `generalized` rotations remain experimental (`cv.glmnet` randomization makes the latter unverifiable even against rENA itself).

## 0.2.0 - 2026-07-11

### Fixed (correctness)

- **Variance explained now matches rENA** (advisory F-001, critical). Shares are normalized across all rotated dimensions instead of only the displayed ones; previously the two reported values always summed to 1.0 and overstated every result (research fixture: SVD1 0.707 → 0.442, now identical to rENA to 1e-9). Any variance figures produced with 0.1.x should be recomputed.
- `RotationSet` now carries the **full** rotation matrix, column names, and eigenvalues (rENA parity); `points`/`nodes` output remains truncated to the requested `dimensions`. This also makes `projectIn` variance correct.
- Directed node-position methods now **throw** on this pipeline's undirected models instead of silently returning meaningless coordinates (F-003).
- Streaming/chunked accumulation now orders units by first appearance, matching batch accumulation and rENA under forward windows (caught by the new equivalence suite).
- The Jacobi eigensolver stops at machine precision relative to the matrix scale and applies rotations in O(n) per step; golden point parity improved from ~1e-6 to ~1e-9.

### Added

- Input validation at every public entry point with named-parameter errors (F-011): empty rows, <2 codes, bad windows/masks/enums, `dimensions < 1`, non-matching `unitsUsed`.
- Golden tests now assert points, node positions, variance, and rotation-matrix columns for **every** fixture configuration (14 configs, both datasets), plus fixture provenance metadata (F-005/F-006).
- Stats parity suite vs rENA/R: `enaCorrelations`, `cohensD`, Welch t, one-way ANOVA, and the (newly exported) `inverseNormal` quantile function (F-015).
- Streaming ≡ batch equivalence tests across all golden configurations (F-007 mitigation).
- ESLint config + `lint` script, GitHub Actions CI (Node 18/20/22) with packaging check and packed-tarball consumer smoke test (F-010).
- `NUMERICS.md` documenting solver deviations, sign-indeterminacy contract, and golden tolerances (F-020); rENA attribution headers and upstream NOTICE in `PROVENANCE.md` (F-017).

### Changed

- npm tarball trimmed to `dist` + docs (1.1 MB → ~0.4 MB unpacked); `prepublishOnly` gate runs lint/typecheck/test/build/pack-check; `engines.node >= 18`; `repository` points at https://github.com/HUDongpin/jENA (F-009).
- README now documents the verified-vs-experimental API surface and the ESM-only policy (F-016).
- Golden fixture regeneration scripts are portable and version-stamp their output; `sena-configs.generated.json` gained a `meta` block and the `personSeparateTrajectory` config (numerics unchanged, verified at 1e-9 over 15,105 values).
- `dist/` is no longer committed; it is built in CI and on `prepare`.

## 0.1.1 - 2026-06-08

- Restored the package source tree alongside the built `dist` output.
- Added package-internal R-derived golden parity fixtures and tests.
- Added coverage for moving forward windows, infinite back windows, sum weighting, conversation windows, accumulated trajectories, separate trajectories, and mean rotation/group comparison.
- Included `src`, `tests`, `scripts`, and `fixtures` in the npm package file list.
- Added formal package documentation and provenance notes.

## 0.1.0

- Initial local jENA package used by the SENA website as a JavaScript ENA runtime.
