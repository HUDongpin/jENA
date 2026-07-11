# jENA

[![CI](https://github.com/HUDongpin/jENA/actions/workflows/ci.yml/badge.svg)](https://github.com/HUDongpin/jENA/actions/workflows/ci.yml)

`jena-js` is a standalone TypeScript/JavaScript implementation of [Epistemic Network Analysis](https://www.epistemicnetwork.org/) (ENA) for browser and Node runtimes, ported from and verified against the [rENA](https://cran.r-project.org/package=rENA) R package (0.3.1).

The runtime is pure JavaScript with **zero runtime dependencies**. It does not require R, Rserve, OpenCPU, or a server process to run ENA models. R is used only at development time to generate golden fixtures and verify numerical parity with rENA.

## Install

```bash
npm install github:HUDongpin/jENA
```

or from a packed tarball:

```bash
npm install ./jena-js-0.2.0.tgz
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

## Entrypoints

```ts
import { ena, accumulateData, makeSet, projectIn, enaCorrelations, cohensD } from "jena-js";
import { rowsToCoOccurrences, refWindowMatrix } from "jena-js/core";
import { createENAPlotModel, toPlotly } from "jena-js/plot";
import { createENAWorkerClient } from "jena-js/browser";
// worker bundle: import "jena-js/browser/worker";
```

## Verified vs experimental surface

Everything in the **verified** tier is tested against golden outputs generated from rENA 0.3.1 (see `fixtures/goldens/`, version-stamped; tolerances documented in [NUMERICS.md](./NUMERICS.md)).

| Area | Status | Notes |
|---|---|---|
| Accumulation: `EndPoint`, `AccumulatedTrajectory`, `SeparateTrajectory` | ✅ Verified | All 14 golden configs, both fixture datasets |
| Windows: moving stanza (back/forward/infinite), conversation | ✅ Verified | Line-faithful port of rENA's C++ `ref_window_df` |
| Weighting: `binary`, `sum` | ✅ Verified | |
| Sphere normalization, centering | ✅ Verified | Includes rENA's zero-row semantics |
| SVD rotation, means rotation | ✅ Verified | Points at ~1e-9, rotation matrices up to sign |
| Variance explained | ✅ Verified | Normalized over all dimensions, 1e-9 vs rENA |
| Undirected node positions + centroids | ✅ Verified | See NUMERICS.md for singular-system tolerance |
| `projectIn` (rotation-set reuse) | ✅ Verified | Self-projection invariant + shared machinery |
| Stats: `enaCorrelations`, `cohensD` | ✅ Verified | vs `rENA::ena.correlations` / `fun_cohens.d` |
| Stats: Welch t, one-way ANOVA (`enaStats`) | ✅ Verified | vs R `t.test` / `aov`; **no p-values** — statistic + df only |
| Rotations: `regression`, `regression2` | ✅ Verified | vs `ena.rotate.by.hena.regression`/`_2` — x-only, x+y, and multi-term formulas (12 golden configs) |
| Rotation: `generalized` (single covariate) | ✅ Verified | vs `ena.rotate.by.generalized` incl. `select2Groups`; variance compared junk-aware (see NUMERICS.md) |
| Streaming/chunked accumulation | ⚠️ Equivalence-tested | Matches batch on all golden configs; no independent rENA goldens |
| Rotation: `generalized` with multiple covariates | 🧪 Experimental | rENA runs this through `cv.glmnet` with randomized folds — not reproducible even by rENA itself; jena uses a deterministic elastic net |
| Rotations: `hena`, `spherical` | 🧪 Experimental | **Not verified against rENA** |
| Directed node positions | 🧪 Experimental | Throws on this pipeline's undirected models; only usable with external n×n directed adjacency data |
| Plot adapters, SVG renderer | 🧪 Experimental | Untested convenience helpers |
| Worker client | 🧪 Experimental | Progress/cancel are coarse (single-run granularity); function-valued `weightBy` cannot cross `postMessage` |

If a rotation or statistic will end up in a publication, stay on the ✅ tier or independently validate your configuration against rENA first.

## Input validation

Malformed inputs throw descriptive errors instead of producing quietly wrong numbers: empty `rows`, fewer than 2 `codes`, negative/fractional window sizes, wrong-shape masks, misspelled `model`/`window`/`weightBy`/`rotation.method`/`nodePositionMethod` values, `dimensions < 1`, and `unitsUsed` filters that match nothing are all rejected.

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
```

See [fixtures/goldens/README.md](./fixtures/goldens/README.md) for the regenerate → diff → adopt workflow. CI runs lint, typecheck, tests, build, a packaging check, and a packed-tarball consumer smoke test on Node 18/20/22.

## Provenance and license

`jena-js` is a TypeScript translation of core [rENA](https://cran.r-project.org/package=rENA) behavior — rENA 0.3.1 (GPL-3) by Cody L Marquart, Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, and David Williamson Shaffer. This package is distributed under **GPL-3.0-only**, preserving the upstream license. See [PROVENANCE.md](./PROVENANCE.md) for the upstream version pin, source history, and file-level attribution, and [NUMERICS.md](./NUMERICS.md) for documented numerical deviations and agreement bounds.
