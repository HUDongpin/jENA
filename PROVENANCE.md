# Provenance and Runtime Notes

`jena-js` (published at https://github.com/HUDongpin/jENA) is a standalone JavaScript/TypeScript ENA runtime derived from the rENA R package.

## Upstream NOTICE

This package is a TypeScript translation of core behavior from:

- **rENA** version **0.3.1** — Epistemic Network Analysis
- Authors: Cody L Marquart, Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, David Williamson Shaffer
- License: GPL-3 | https://cran.r-project.org/package=rENA
- Upstream repository: https://gitlab.com/epistemic-analytics/qe-packages/rENA

The pinned reference snapshot used for the port and for golden-fixture parity is `rENA-main.zip` (rENA 0.3.1):

```
SHA-256: 78a9698859557084d1235e144b29c0911a2994ab4ad036f3af06925e35469329
```

The zip is not committed to this repository (19 MB); unpack it to `reference/rENA-main/` (git-ignored) for line-level comparison work, or fetch rENA 0.3.1 from CRAN/GitLab and verify against the hash above.

## File-level attribution (direct ports)

| jena-js file | rENA source |
|---|---|
| `src/core/matrix.ts` (`refWindowMatrix`, `rowsToCoOccurrences`, `sphereNorm`) | `src/ena.cpp` (`ref_window_df`, `rows_to_co_occurrences`, `fun_sphere_norm`) |
| `src/accumulate.ts` | `R/ena.accumulate.data.R` and accumulation helpers |
| `src/model.ts` (`makeSet`, centering, variance) | `R/ena.make.set.R` |
| `src/rotation/svd.ts` | `R/ena.svd.R` (prcomp-based SVD rotation) |
| `src/rotation/custom.ts` (`rotateByMean`, others experimental) | `R/ena.rotate.by.mean.R`, `ena.rotate.by.regression*.R`, `ena.rotation.h.R` |
| `src/rotation/nodePositions.ts` (undirected solver) | `src/ena.cpp` (`lws_lsq_positions`), `R/lws.positions.sq.R` |
| `src/stats.ts` (`cohensD`, `enaCorrelations`) | `R/cohens.d.R` (`fun_cohens.d`), `R/ena.correlations.R` |
| `src/performance.ts` (streaming re-implementation of the above) | same window/accumulation semantics as `src/ena.cpp` |

Modifications and the TypeScript translation are © the jena-js contributors, distributed under GPL-3.0-only (see LICENSE).

## Source History

- The project descends from a local jENA template created for a browser/Node port of rENA.
- The `src/` tree was at one point reconstructed from package build sourcemaps, then completed with entrypoints, tests, scripts, and R-derived fixtures; since v0.2.0 the repository (with CI and a committed lockfile) is the canonical source of truth.
- Golden fixtures are version-stamped with the exact R/rENA/tma versions that generated them, and regeneration was verified reproducible (0 differing values at 1e-9) on R 4.4.2 / rENA 0.3.1 / tma 0.3.1 (aarch64-apple-darwin20).

## Runtime Boundary

The package runtime is pure JavaScript:

- no R runtime, Rserve, or OpenCPU service is required;
- no server runtime is required for browser use;
- no framework dependency (React/Next.js) is required;
- zero runtime npm dependencies;
- the library performs **no network I/O, no filesystem access, and no persistence** — all data stays in caller memory (tests and dev-time R scripts are the only code touching disk).

R is used only for development-time tasks: regenerating golden fixtures (`npm run goldens:r`, `npm run goldens:stats`) and comparing behavior to rENA in tests.

## License

Distributed under **GPL-3.0-only**. rENA is the upstream GPL-3 work this package translates; the GPL posture (license, attribution, and corresponding source via this repository) is preserved. See the Upstream NOTICE above.
