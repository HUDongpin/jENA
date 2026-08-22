# Changelog

## 0.7.0-ona.0 (unpublished prerelease) - 2026-08-22

This prerelease exists only in the local source branch. It has not been tagged
or published to npm.

### Added: ordered network API

- Added the opt-in `networkType: "ordered"` accumulation mode. Omitting
  `networkType` still selects `"standard"`; the standard ENA numerical path,
  defaults, and rENA golden outputs are unchanged.
- Added a full directed `p²` adjacency, including diagonal cells. Entries use
  ground/source as matrix row, response/target as matrix column, and
  column-major flattening (`responseIndex * p + groundIndex`). Public
  `adjacencyKey` entries carry explicit source/target labels and indices.
- Added public ordered provenance through `OrderedWindowProvenance`,
  `ENAData.rowWindowProvenance`, and
  `expandOrderedPriorRowIndices(provenance, responseRowIndex)`. The compact
  predecessor chain remains present in model-only materialization without
  retaining raw rows or per-row connection tables.
- Added `orderedAdjacencyKey` and `validateENADataNetworkContract` to the stable
  root surface, plus the public `NetworkType` and optional `networkType` fields
  on accumulation/data/function-parameter contracts.
- Ordered `makeSet()` now selects the directed node-position solver by default.
  The solver's incident weights count a self-loop once and a non-self edge at
  both endpoints.

### Scientific contract

- Each response row receives prior-ground × current-response products and half
  of every off-diagonal same-row product in both directions. Same-row diagonal
  mass is excluded; repeated codes across rows produce self-loops.
- Ordered accumulation preserves raw code counts and therefore defaults to
  `weightBy: "sum"`. A directional `p x p` mask is interpreted as
  `mask[ground/source][response/target]`, diagonal included.
- `windowSizeBack` is the total stanza width: the current row plus at most
  `N - 1` prior rows in the same typed horizon. Distinct typed horizons never
  share context; interleaved rows continue their own horizon chains in caller-
  supplied input order. Each connection contribution belongs to its response
  row's analytic unit.
- The canonical Yu oracle matched all 87 unit rows × 49 directed dimensions,
  total connection mass 811, and three zero networks with zero differing
  cells. Oracle versions and hashes are recorded in PROVENANCE.md.

### Validation, lifecycle, and performance

- Ordered analysis fails closed outside the endpoint, backward-only moving
  window, raw-sum contract. Conversation and trajectory models, forward
  windows, binary/custom weighting, undirected node positions, and the paired
  ground/response solver are rejected.
- Runtime `ENAData` validation now checks network/model/function-parameter
  agreement, exact ordered headers/key order, and all `p²` widths and
  count/matrix values before `makeSet()` or `projectIn()` models data. The
  provenance expansion helper separately validates a persisted compact chain
  before reading it. Duplicate codes, colliding ordered display headers, and
  ambiguous unit display labels fail closed; delimiter- and type-colliding
  horizon displays remain separate through collision-free typed identities.
- Ordered finite windows use bounded removable history, while infinite windows
  use running sums. Both store O(rows) compact provenance rather than copying
  prior-row arrays. Batch, chunked, and manual streaming output is identical;
  finished streams release active histories and reject further use.

### Public compatibility note

- This prerelease adds public discriminants, fields, and helpers listed above;
  consumers that exhaustively switch over public unions or assert exact object
  shapes must handle the new ordered values and optional provenance fields.
  There is no breaking change to ordinary standard ENA calls.
- ONA-specific 3D/trajectory rendering, forward ONA, paired models,
  reference-set workflows, and TMA workflows are not claimed by this package
  prerelease and require separate application-level validation.

## 0.6.3 - 2026-08-21

- Removed the accidental `jena-js@^0.6.0` self-dependency from both the
  published manifest and the lockfile. The package once again matches its
  documented zero-runtime-dependency contract; no numerical, API, or runtime
  implementation changed.
- Hardened `pack-check` so a release fails closed if `package.json` or the
  lockfile root declares any runtime, optional, peer, or bundled dependency.
  This makes the packaging defect reproducible in CI instead of relying on a
  manual manifest inspection.
- Updated the Vitest browser toolchain to 3.2.7 and refreshed compatible
  transitive development dependencies, removing the known critical and high
  audit findings from the CI test stack. These tools are not shipped in the
  package tarball.
- Restricted the CI token to read-only repository contents, pinned the GitHub
  Actions used by the workflow to immutable commits, and added production-zero
  plus high/critical development audit gates for public-repository CI.

## 0.6.2 - 2026-07-12

- `package.json` `sideEffects` is now `["./dist/browser/worker.js"]` instead
  of `false`. The worker entry registers its protocol-v1 message host as a
  module side effect, so under `sideEffects: false` a bundler consuming a
  bare `import "jena-js/browser/worker"` tree-shook the registration away —
  webpack/Next.js emitted an ~8-byte empty worker chunk and the worker hung
  silently at 0% (first hit by SENA, which had to anchor the import through
  an exported binding as a workaround). All other entries remain declared
  pure. `pack-check` now asserts the declaration so it cannot regress.
  No runtime changes.

## 0.6.1 - 2026-07-11

- Added `RELEASING.md`: the practiced release checklist (gates, the npm web-2FA timing note, tagging, GitHub release, and the registry-install smoke test), closing the advisory's remaining documentation item (T-16). No runtime changes.

## 0.6.0 - 2026-07-11

Closes the remaining advisory architecture/performance items (F-007, F-012, F-013, F-014).

### Breaking (API tiering, F-012)

- The root entry now exports only the **stable tier** (~24 runtime names): the verified pipeline (`ena`, `accumulateData` + chunked/streaming, `makeSet`, `projectIn`), all types, the six stats functions, and the rENA-verified accumulation kernels. Migrations: rotation functions → `jena-js/rotation`; plot helpers → `jena-js/plot`; worker client → `jena-js/browser`; elastic net + typed-array helpers → `jena-js/experimental`; numerical internals → `jena-js/core` (internal tier, no semver guarantees).
- `RotationOptions` is a discriminated union — each rotation method's params shape is compile-checked.
- `ENAPlotRenderer.element` and the worker message event types are now structural (`SVGNodeLike`, `ENAWorkerMessageEvent<T>`) rather than DOM-lib types.

### Changed

- **One accumulation engine** (F-007): `accumulateData` is a thin wrapper over the streaming core; the duplicated batch machinery is deleted. Verified by full-object chunk-size equivalence on all golden configs plus a 120-case randomized property suite (all models × windows × weights, with masks) against an independent `refWindowMatrix` oracle.
- **Performance** (F-013): cyclic-by-row Jacobi (190×190 eigensolve ~2991 ms → ~389 ms), radix-argsort ranks and typed-array difference vectors (2000-unit correlations ~3856 ms → ~313 ms), flat mask vectors, Map-based plot edge lookup. `npm run bench` enforces the advisory budgets in CI; baselines and scale guidance in `bench/BASELINES.md`.
- **DOM-free core** (F-014): the package compiles with `lib: ["ES2022"]` — no DOM lib anywhere; browser-facing files use minimal structural types. New real-browser harness (`npm run test:browser`, Playwright Chromium, CI job): genuine Worker round-trip tests and an SVG renderer DOM smoke test.
- **Custom `weightBy` functions golden-verified (F-019 resolved)**: new `sqrt`-weighted golden configs on both datasets confirm jena's per-cell application matches rENA's runtime behavior to machine precision. The advisory's premise (that rENA applies the function to accumulated vectors) traces to rENA's docstring, which contradicts its own implementation (`by = 1:nrow` makes the function see one window cell at a time) — reported upstream. `WeightBy` now documents the exact contract.
- **Plot model + plotly adapter fully tested**: 16 contract tests cover `createENAPlotModel` (dimension defaults, node/point/fixed/partial axis scaling with the 1e-9 degenerate-axis floor), every trace builder (selectors, palette cycling, group means, node labels, trajectory ordering), `networkFromConnectionRow` (adjacency-name weights, strict `minWeight` filtering), node-position injection, `scalePlot`, and the `toPlotly` mapping (marker/line modes, per-edge line traces with endpoint resolution and width scaling, unknown-node fallback, layout).

## 0.5.0 - 2026-07-11

### Verified

- **`hena` rotation is golden-verified against rENA's `ena.rotation.h`** (6 configurations: x-only, x+y, factor-expanded controls, x·y interaction, centering on/off). The port now reproduces rENA's `rleidv` run-length dummy coding (with `_f` column-name suffixes), lm-style factor contrasts for character controls, y-axis orthogonalization, and the prcomp-style basis completion.
- **The multivariate elastic net is verified against glmnet** (`family = "mgaussian"`) at fixed lambdas to 1e-6 — group lasso across responses, internal standardization, glmnet penalty-factor rescaling, intercept handling, and α-mixing (new fixture + `npm run goldens:elasticnet`). rENA's lambda *selection* (`cv.glmnet`) randomizes folds and is not reproducible even across rENA runs; jena's CV is deterministic (round-robin folds over a glmnet-style path) — see NUMERICS.md.
- **`spherical` is documented as a jena-specific extension** — rENA 0.3.1 has no spherical rotation. Its anchor semantics, orthonormality, and variance conservation are locked by spec tests.

### Breaking

- `elasticNet`/`elasticNetCV` (per-response lasso with a fixed lambda grid) are replaced by `multiGaussianElasticNet`/`multiGaussianElasticNetCV` (glmnet-compatible). The multi-covariate `generalized` rotation now uses the verified solver, and its fitted main effect no longer includes the intercept (matching rENA's `get_x1_main_effect`).
- `HenaRotationParams.formula` was removed: the previous parser silently mis-parsed R formula syntax; the advisory calls for loud rejection. Use `xVar`/`yVar`/`controlVars`/`includeXY`.

## 0.4.0 - 2026-07-11

### Worker protocol v1 (advisory F-008) — breaking for direct protocol users

- **Progress and cancellation are now real.** The worker drives accumulation through the streaming engine chunk-by-chunk and yields to the event loop between chunks, so `cancel` messages are delivered mid-run and take effect at the next chunk boundary; progress events are monotonic and chunk-granular (accumulation spans 0–0.9, the model stage 0.9–1). Previously the whole run was one synchronous call: progress was exactly 0 then 1, and "cancel" merely suppressed the result.
- **Cancelled runs now settle.** The worker posts a `cancelled` response and the client rejects with the new `ENAWorkerCancelledError`; before, a cancelled run's promise stayed pending forever. Cancel bookkeeping no longer leaks (the old module-level Set grew unboundedly).
- **A crashed worker no longer hangs callers**: the client listens for `error`/`messageerror` and rejects every in-flight run. Per-run `timeoutMs` (rejects and cancels the worker-side run), `AbortSignal`, and `chunkSize` options added. Result payloads are shape-validated instead of blindly cast.
- **Function-valued `weightBy` is rejected at compile time** (`ENAWorkerOptions` narrows it to `"binary" | "sum"`) and with a clear runtime `TypeError` — it previously threw an opaque `DataCloneError` at `postMessage`.
- Messages are versioned (`{ v: 1, kind: 'run' | 'cancel' | 'progress' | 'result' | 'cancelled' | 'error', id }`). The old `ENAWorkerRequest`/`ENAWorkerCancel`/`ENAWorkerResponse` type shapes are replaced. Runs are serialized per worker; queued runs can be cancelled before they start.
- New `createENAWorkerHost(scope)` export hosts the production message handler on any scope, making the module importable from Node — the protocol is covered by 12 tests on an in-memory channel with structured-clone semantics.
- New `extractMakeSetOptions` helper shared by `ena()` and the worker.

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
