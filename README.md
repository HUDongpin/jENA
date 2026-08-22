# jENA

[![CI](https://github.com/HUDongpin/jENA/actions/workflows/ci.yml/badge.svg)](https://github.com/HUDongpin/jENA/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/jena-js.svg)](https://www.npmjs.com/package/jena-js)

`jena-js` is a standalone TypeScript/JavaScript implementation of [Epistemic Network Analysis](https://www.epistemicnetwork.org/) (ENA) for browser and Node runtimes. Its standard ENA path is ported from and verified against the [rENA](https://cran.r-project.org/package=rENA) R package (0.3.1); the `0.7.0-ona.0` prerelease also contains an independently implemented, opt-in ordered-network path documented below.

The runtime is pure JavaScript with **zero runtime dependencies**. It does not require R, Rserve, OpenCPU, or a server process to run ENA models. R is used only at development time to generate golden fixtures and verify numerical parity with rENA.

## Install

The registry command below installs the latest version published to npm. The
`0.7.0-ona.0` ordered prerelease described later in this document is not
published to npm.

```bash
npm install jena-js
```

The latest published package is `jena-js@0.6.3`; its exact complete repository
source is commit
[`57b7794ec3873c251c33086454523e5a3949836f`](https://github.com/HUDongpin/jENA/commit/57b7794ec3873c251c33086454523e5a3949836f).
See `PROVENANCE.md` for the object-to-source mapping and its release-review
boundary.

The GitHub command instead installs the current development version straight
from `main`; pin an exact reviewed commit or tag when reproducibility matters:

```bash
npm install github:HUDongpin/jENA
```

**ESM only.** The package ships ES modules and requires Node ≥ 18 or a bundler; `require("jena-js")` is not supported.

## Usage

```ts
import { ena } from "jena-js";

const set = ena({
  rows: [
    { unit: "u1", conv: "c1", A: 1, B: 0, C: 0 },
    { unit: "u1", conv: "c1", A: 0, B: 1, C: 0 },
    { unit: "u2", conv: "c1", A: 1, B: 1, C: 0 }
  ],
  units: ["unit"],
  conversation: ["conv"],
  codes: ["A", "B", "C"],
  model: "EndPoint",
  window: "MovingStanzaWindow",
  weightBy: "binary",
  windowSizeBack: 2,
  dimensions: 2
});

console.log(set.points);          // projected unit points (SVD1, SVD2)
console.log(set.rotation.nodes);  // code node positions
console.log(set.variance);        // variance explained per rotated dimension
```

Note on `variance`: shares are normalized across **all** rotated dimensions (rENA semantics), so `SVD1 + SVD2` generally sums to less than 1. Dimension signs are arbitrary (SVD sign indeterminacy) — compare axes up to sign. See [NUMERICS.md](./NUMERICS.md).

## Ordered Network Analysis (ONA) prerelease

> `0.7.0-ona.0` is an untagged prerelease available from the public review
> branch and source checkout. It has not been published to npm.

From an existing local checkout of this prerelease, an application can install
that checkout explicitly:

```bash
npm install /absolute/path/to/jENA-ona-checkout
```

Set `networkType: "ordered"` to build an ordered, directed endpoint network.
The ordinary ENA call remains the default: omitting `networkType` is exactly
equivalent to `networkType: "standard"` and retains the existing standard ENA
numerical path and defaults.

```ts
import { ena, expandOrderedPriorRowIndices } from "jena-js";

const set = ena({
  rows: [
    { student: "u1", lesson: "L1", Ask: 1, Explain: 0 },
    { student: "u1", lesson: "L1", Ask: 0, Explain: 1 }
  ],
  units: ["student"],
  conversation: ["lesson"], // typed horizon; distinct values never share context
  codes: ["Ask", "Explain"],
  networkType: "ordered",
  windowSizeBack: 2,         // current row plus at most one prior row
  mask: [                    // row = source/ground, column = target/response
    [1, 1],
    [1, 1]
  ],
  dimensions: 2
});

const askToExplain = set.adjacencyKey.find(
  (edge) => edge.source === "Ask" && edge.target === "Explain"
);
if (!askToExplain) throw new Error("Ask -> Explain edge is missing");

console.log(set.rowConnectionCounts[1]?.[askToExplain.name]); // 1
console.log(
  expandOrderedPriorRowIndices(set.rowWindowProvenance ?? [], 1)
); // [0]
console.log(set.rotation.nodes); // directed node positions are the default
```

### Ordered scientific and indexing contract

For each response row `t`, the ground vector is the sum of the included prior
code rows and the response vector is the current code row. Ordered accumulation
adds the ground-to-response outer product, plus one half of each off-diagonal
same-row product in both directions; same-row diagonal mass is excluded. Raw
code counts are preserved. For example, a prior `Ask = 2` followed by current
`Explain = 3` contributes `6` to `Ask -> Explain`, while `Ask = 2` and
`Explain = 3` on the same row contribute `3` in each direction.

An ordered network has the full `p²` directed adjacency, including diagonal
self-loop cells. Matrix rows are ground/source/from codes and matrix columns
are response/target/to codes. The flat connection vector is column-major:

```text
edgeIndex = responseIndex * codes.length + groundIndex
```

`adjacencyKey` is emitted with response as the outer loop and ground as the
inner loop. Its display header is `<ground> & <response>`, but callers must use
the entry's `source`, `target`, `sourceIndex`, and `targetIndex` for direction
instead of parsing the display string. Ambiguous headers and duplicate code
labels fail closed. A directional mask uses the same orientation:
`mask[sourceIndex][targetIndex]`, including its diagonal.

`windowSizeBack` counts the current row, so `1` means same-row contributions
only, `2` means current plus one prior row, and `Infinity` means every preceding
row in the same typed horizon. This parameter is intentionally not numerically
identical to the pinned tma oracle's `simple_window(window_size = k)`, where
`k` counts preceding rows: use jENA `windowSizeBack = k + 1` for the same finite
cutoff. The committed four-row R golden distinguishes and tests windows 1, 2,
and 3; the two-row Yu oracle alone cannot detect that offset. Contributions are
assigned to the response row's analytic unit, even when a prior row belongs to
a different unit.
The accumulator consumes rows in exactly the order supplied; it does not sort
or validate an order/Lesson/timestamp column. Callers must stable-sort rows into
their intended response order before a batch call or before pushing stream
chunks. Distinct typed horizons never share context. If input later returns to
an earlier horizon identity, that horizon continues its own predecessor chain
in caller-supplied order.
`rowWindowProvenance` stores one compact predecessor-chain entry per response
row (`responseRowIndex`, display `horizon`, collision-free `horizonIdentity`,
`previousRowIndex`, and `priorRowCount`). Use
`expandOrderedPriorRowIndices(provenance, responseRowIndex)` to reconstruct the
exact prior row indices; do not infer the window from display labels in an
application.

Ordered `makeSet()` selects `nodePositionMethod: "directed"` by default. The
directed solver accepts the full column-major `p²` line-weight vector, counts a
self-loop once at its incident node, and counts a non-self edge at both source
and target nodes.

### Fail-closed ordered MVP boundary

The package-enforced ordered contract is `EndPoint` + backward-only
`MovingStanzaWindow` + raw `weightBy: "sum"`. `windowSizeForward` must be `0`
and `windowSizeBack` must be an integer at least `1` or `Infinity`. The ordered
entry points reject `Conversation`, `AccumulatedTrajectory`,
`SeparateTrajectory`, forward windows, binary/custom weighting, the undirected
node solver, and the paired `directed-ground-response` solver. Ordered
`makeSet()` accepts only the default or explicit SVD rotation; it rejects every
custom rotation, `rotationSet`, and `projectIn()` route in this phase.

The descriptive SVD resource boundary is deliberately fixed and has no bypass:
at most 12 codes / 144 directed edges, estimated work
`units × E² + E³ <= 8,000,000`, and estimated dense numeric payload
`8 × (3E² + 2 × units × E) <= 1,048,576` bytes, where `E = codes²`. The verified
Yu contract uses 7 codes and 87 units (326,536 work units and 125,832 estimated
bytes). Larger ordered models require a separately designed and verified solver
rather than an unchecked allocation through the current dense SVD path.

The package does not advertise an ONA-specific 3D renderer, trajectory view,
forward-ONA model, paired-ground/response model, reference-set workflow,
custom-rotation workflow, GoF workflow, or TMA workflow. Generic package APIs
available to standard ENA are not verification of those ONA workflows.
Integrating applications must keep those surfaces unavailable until they have
their own scientific contract and parity tests.

## Entrypoints (API tiers)

The root export is the **stable tier** — the verified pipeline, types, stats, and accumulation kernels only (~two dozen names, semver-guarded). Everything else lives behind subpaths:

```ts
import { ena, accumulateData, makeSet, projectIn, enaCorrelations, cohensD } from "jena-js";
import { rotateByMean, svdRotation, lwsLeastSquaresPositions } from "jena-js/rotation";
import { createENAPlotModel, toPlotly, renderENAPlot } from "jena-js/plot";
import { createENAWorkerClient } from "jena-js/browser";       // worker bundle: "jena-js/browser/worker"
import { multiGaussianElasticNet } from "jena-js/experimental"; // may change in any release
import { solveLinearSystem } from "jena-js/core";               // internal tier: no semver guarantees
```

`RotationOptions` is a discriminated union — each rotation method's parameter shape is enforced at compile time.

**Migrating from ≤0.5.x:** the root previously re-exported the entire codebase. Rotation functions moved to `jena-js/rotation`, plot helpers to `jena-js/plot`, the worker client to `jena-js/browser`, the elastic net and typed-array table helpers to `jena-js/experimental`, and numerical internals (linear solvers, Gram-Schmidt, matrix utilities) are only available from `jena-js/core`. Code that used `ena`/`accumulateData`/`makeSet`/`projectIn`/stats from the root is unaffected.

## Verified vs experimental surface

The standard ENA areas in the **verified** tier are tested against golden outputs generated from rENA 0.3.1 (see `fixtures/goldens/`, version-stamped; tolerances documented in [NUMERICS.md](./NUMERICS.md)). The ordered endpoint row below has a separate ONA R-oracle contract recorded in [PROVENANCE.md](./PROVENANCE.md).

| Area | Status | Notes |
|---|---|---|
| Accumulation: `EndPoint`, `AccumulatedTrajectory`, `SeparateTrajectory` | ✅ Verified | All 16 golden configs, both fixture datasets |
| Ordered endpoint accumulation | ✅ R-oracle + contract tested | Full column-major `p²`, backward moving windows, raw sums, provenance, streaming parity; see PROVENANCE.md |
| Windows: moving stanza (back/forward/infinite), conversation | ✅ Verified | Line-faithful port of rENA's C++ `ref_window_df` |
| Weighting: `binary`, `sum`, custom functions | ✅ Verified | Custom functions golden-tested (`sqrt` configs); applied once per windowed co-occurrence cell before unit accumulation — matches rENA's implementation (its docstring says otherwise; noted in [rENA#48](https://gitlab.com/epistemic-analytics/qe-packages/rENA/-/issues/48)) |
| Sphere normalization, centering | ✅ Verified | Includes rENA's zero-row semantics |
| Standard ENA SVD and means rotation | ✅ Verified | Points at ~1e-9, rotation matrices up to sign |
| Ordered rotation | ✅ SVD-only contract | Default/explicit SVD only; custom rotations, `rotationSet`, and `projectIn` fail closed in this phase |
| Variance explained | ✅ Verified | Normalized over all dimensions, 1e-9 vs rENA |
| Undirected node positions + centroids | ✅ Verified | See NUMERICS.md for singular-system tolerance |
| Standard ENA `projectIn` (rotation-set reuse) | ✅ Verified | Self-projection invariant + shared machinery; ordered data is rejected |
| Stats: `enaCorrelations`, `cohensD` | ✅ Verified | vs `rENA::ena.correlations` / `fun_cohens.d` |
| Stats: Welch t, one-way ANOVA (`enaStats`) | ✅ Verified | vs R `t.test` / `aov`; **no p-values** — statistic + df only |
| Rotations: `regression`, `regression2` | ✅ Verified | vs `ena.rotate.by.hena.regression`/`_2` — x-only, x+y, and multi-term formulas (12 golden configs) |
| Rotation: `generalized` (single covariate) | ✅ Verified | vs `ena.rotate.by.generalized` incl. `select2Groups`; variance compared junk-aware (see NUMERICS.md) |
| Rotation: `hena` | ✅ Verified | vs `ena.rotation.h` — x/y, factor-expanded controls, interaction, centering on/off (6 golden configs), incl. rENA's run-length dummy coding |
| Elastic-net solver (`multiGaussianElasticNet`) | ✅ Verified | vs glmnet `mgaussian` at fixed lambdas (1e-6): group lasso, standardization, penalty factors, α-mixing |
| Streaming/chunked accumulation | ✅ Verified | Single engine since 0.6.0 (batch delegates to it): all rENA golden parity suites run through it, plus chunk-size equivalence and a 120-case randomized property suite with an independent window oracle |
| Rotation: `generalized` with multiple covariates | ⚠️ Solver-verified | The elastic-net **solver** matches glmnet at equal lambda (1e-6). Full-pipeline parity is out of reach for two reasons: rENA selects lambda via `cv.glmnet`, whose fold assignment is randomized (irreproducible across runs unless the caller seeds R's RNG — rENA does not), and rENA's design matrix (`model.matrix(~ .^2)`: factor expansion, all pairwise interactions) differs from jena's simplified design. jena is deterministic end-to-end (round-robin folds over a glmnet-style path) — see NUMERICS.md |
| Rotation: `spherical` | 🔷 jena extension | **No rENA counterpart exists** — anchors axes at chosen adjacency directions; spec-tested (orthonormality, anchor semantics) |
| Directed node positions | ✅ Ordered spec-tested / 🧪 external | Default for ordered full-`p²` data; external square directed data remains experimental |
| Plot model, plotly adapter, SVG renderer | ✅ Tested (jena-specific) | 16 contract tests pin every builder and the plotly trace/layout mapping; SVG renderer smoke-tested in real Chromium. No rENA golden — rENA's R-plotly stack is structurally incomparable |
| Worker client + protocol | ✅ Protocol + browser tested | Versioned protocol v1: chunked accumulation cancel; factory-backed hard stop/recreate for synchronous model cancel, abort, or timeout; client-side pre-clone admission plus an O(1) bounded host queue — 30 protocol tests plus four real-Chromium Worker tests |

If a rotation or statistic will end up in a publication, stay on the ✅ tier or independently validate your configuration against rENA first.

## Input validation

Malformed inputs throw descriptive errors instead of producing quietly wrong
numbers: empty `rows`, fewer than 2 or duplicate `codes`, negative/fractional
window sizes, wrong-shape masks, misspelled option values, `dimensions < 1`, and
`unitsUsed` filters that match nothing are all rejected. Ordered data also
rejects generated-edge collisions with declared or runtime row keys, non-scalar
unit/conversation/metadata identity values, code columns reused as analytic
identity or metadata columns, positive mask underflow, non-finite connections
or unit aggregates, unsafe resource estimates, and any persisted directed-schema
mismatch before modeling. A zero directional mask short-circuits that edge
before product evaluation. `expandOrderedPriorRowIndices` validates a persisted
provenance chain before expanding it. Typed horizons keep valid scalar types
separate, while indistinguishable formatted unit labels fail closed rather than
merging analytic units.

For cancellable browser work that must remain reusable through a synchronous
model/SVD abort, construct the client with a fresh-worker factory:

```ts
const workerFactory = () => new Worker(workerUrl, { type: "module" });
const client = createENAWorkerClient(workerFactory(), { workerFactory });
```

Factory-backed cancellation terminates the current worker, rejects the target
with `ENAWorkerCancelledError`, rejects other requests discarded with that
worker as `ENAWorkerRestartedError`, and binds a replacement. The one-worker
form remains compatible: its cancellation Promise rejects immediately after a
cooperative cancel is posted; observed model-stage cancellation terminates a
supported worker and makes that client unavailable. If synchronous model work
begins before its progress event is observed, it may continue even though the
Promise has rejected; use a factory when CPU preemption is required. A custom
shim without `terminate()` cannot preempt synchronous model work. The client
admits at most 33 posted runs without a worker terminal response by default and
rejects excess work before `postMessage`; immediate cooperative Promise
rejection does not release that slot until the worker acknowledges a terminal
response. The worker host independently retains at most 32 waiting runs. Set
`maxPendingRuns` or host `maxQueuedRuns` explicitly only when the surrounding
resource budget has been reviewed.

## Development

```bash
npm install
npm run lint
npm run typecheck
npm test
npm run build
npm run pack:check
```

Golden fixtures are committed, so tests run without R. To regenerate them (requires R with rENA installed):

```bash
npm run goldens:r       # model fixtures -> sena-configs.regenerated.json
npm run goldens:diff    # compare regenerated vs committed at 1e-9
npm run goldens:stats   # stats fixtures (correlations, cohen's d, t/F tests)
npm run goldens:ordered-window # distinguishing tma finite-window fixture
```

See [fixtures/goldens/README.md](./fixtures/goldens/README.md) for the regenerate → diff → adopt workflow. CI runs lint, typecheck, tests, build, a packaging check, and a packed-tarball consumer smoke test on Node 18/20/22.

## Provenance and license

The standard ENA core in `jena-js` is a TypeScript translation of core [rENA](https://cran.r-project.org/package=rENA) behavior — rENA 0.3.1 (GPL-3) by Cody L Marquart, Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and David Williamson Shaffer. The ordered extension is an independent TypeScript implementation described in PROVENANCE.md. This package is distributed under **GPL-3.0-only**, preserving the upstream license. See [PROVENANCE.md](./PROVENANCE.md) for the upstream version pin, source history, file-level attribution, ordered oracle evidence, and release gate, and [NUMERICS.md](./NUMERICS.md) for documented numerical deviations and agreement bounds.
