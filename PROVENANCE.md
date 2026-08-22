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
| `src/rotation/custom.ts` (`rotateByMean`, `rotateByRegression`/`2`, `rotateByGeneralized`, `rotateByHena` verified; `rotateBySpherical` is a jena extension with no rENA counterpart) | `R/ena.rotate.by.mean.R`, `ena.rotate.by.regression*.R` (`ena.rotate.by.hena.regression`/`_2`), `ena.rotate.by.generalized.R`, `R/gmr.R`, `ena.rotation.h.R` |
| `src/rotation/elasticNet.ts` (glmnet-compatible multivariate elastic net) | mirrors `glmnet::glmnet(family = "mgaussian")` semantics used by `R/gmr.R` (`get_x1_main_effect`) |
| `src/rotation/nodePositions.ts` (undirected solver) | `src/ena.cpp` (`lws_lsq_positions`), `R/lws.positions.sq.R` |
| `src/stats.ts` (`cohensD`, `enaCorrelations`) | `R/cohens.d.R` (`fun_cohens.d`), `R/ena.correlations.R` |
| `src/performance.ts` (streaming re-implementation of the above) | same window/accumulation semantics as `src/ena.cpp` |

Modifications and the TypeScript translation are © the jena-js contributors, distributed under GPL-3.0-only (see LICENSE).

## Ordered Network Analysis extension (2026-08-22)

The ordered-network behavior added for the `0.7.0-ona.0` prerelease is an
independent TypeScript implementation of the mathematical and behavioral
semantics observed in the official ONA context and verified against an R
oracle. It is not represented as a line-by-line port of the ONA R source. The
existing rENA-derived standard ENA files and attribution in the table above
remain unchanged.

The local R context used for ordered parity reported these package versions:

- `ona` 0.1.2.9003
- `tma` 0.3.2.9002
- `rENA` 0.4.2.9003

The canonical parity case used the following local-only oracle inputs. These
absolute paths describe the verification environment; neither the workbook nor
the generated CSV is distributed in the npm tarball.

| Oracle artifact | Local path | SHA-256 |
|---|---|---|
| Yu coded workbook | `/Volumes/Starship/ONA/Yu_ena_coded_data_0712.xlsx` | `f2132f8dc3e147609169472594a2031130be23eab4a2ac0fb9adcb6d9d667042` |
| R ordered connection-count golden | `/Volumes/Starship/ONA/ona_output/yu_within_student/ona_connection_counts.csv` | `b4c0a6921ece7df51d846b3864e239747062da304a212aa0e2402d4a85074253` |

The oracle harness pre-sorted input rows by `Lesson` and used `Group + Name` as
both analytic unit and ordered horizon; the jENA accumulator itself did not
perform that sort. The TypeScript result matched the R oracle's 87 unit
networks and 49 directed connection columns exactly: total raw connection mass
811, three zero networks, zero cell mismatches, and maximum numeric error 0.
This oracle validates ordered connection counts and schema/order for that
configuration; it does not by itself establish parity for every downstream
visualization or workflow.

The ordered extension, all modifications, and the corresponding source remain
under **GPL-3.0-only**. Before any public tag, npm publication, bundled product
release, or source distribution, the release owner must recheck corresponding
source availability, retained license/attribution notices, and the applicable
legal/license posture. Passing the numerical oracle and package tests is not a
substitute for that release gate.

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
