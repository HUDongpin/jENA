# Provenance and Runtime Notes

`jena-js` (published at https://github.com/HUDongpin/jENA) is a standalone JavaScript/TypeScript ENA runtime derived from the rENA R package.

## Upstream NOTICE

This package is a TypeScript translation of core behavior from:

- **rENA** version **0.3.1** — Epistemic Network Analysis
- Authors: Cody L Marquart, Zachari Swiecki, Wesley Collier, Brendan Eagan, Roman Woodward, David Williamson Shaffer
- License: GPL-3 | https://cran.r-project.org/package=rENA
- Upstream repository: https://gitlab.com/epistemic-analytics/qe-packages/rENA

The local reference archive used for the port and golden-fixture comparison is
`rENA-main.zip` (rENA 0.3.1). Its ZIP comment pins upstream commit
`2c079126cc2ea2372f5f67470abfa446fcfe57e9`, available at the permanent
[GitLab commit URL](https://gitlab.com/epistemic-analytics/qe-packages/rENA/-/commit/2c079126cc2ea2372f5f67470abfa446fcfe57e9).
The exact local archive bytes have this identity:

```
SHA-256: 78a9698859557084d1235e144b29c0911a2994ab4ad036f3af06925e35469329
```

The ZIP is not committed to this repository (19 MB); unpack it to
`reference/rENA-main/` (git-ignored) for line-level comparison work. The hash
above applies only to those exact ZIP bytes. The CRAN source tarball
[`rENA_0.3.1.tar.gz`](https://cran.r-project.org/src/contrib/rENA_0.3.1.tar.gz)
has SHA-256
`73fd301bacaebe8ad5421725327157c805a83f1cfbc7c25666c03d3322c33ef2`.
CRAN tarballs, commit-named GitLab archives, and the local ZIP use different
archive containers and metadata, so their byte hashes are not expected to
match; use the pinned commit for source identity and each archive's own hash
for transport integrity.

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
semantics exercised by the pinned R oracles described below. It is not
represented as a line-by-line port of the ONA R source or as product-level
parity with official webENA.

This prerelease was integrated into the existing rENA-derived jena-js codebase
on 2026-08-22. It modifies the directly attributed modules
`src/core/matrix.ts`, `src/model.ts`, `src/performance.ts`, and
`src/rotation/nodePositions.ts` for ordered adjacency and numerical stability,
network-contract validation and directed dispatch, ordered
streaming/provenance and stream disposal, and directed-node validation and
self-loop handling. Their upstream rENA attribution remains as listed above.
The standard rENA golden outputs remain test-identical; that result does not
mean these source files were unchanged. See `CHANGELOG.md` for the dated
modification record.

The local R context used for the Yu ordered-count oracle reported these package
versions:

- `ona` 0.1.2.9003
- `tma` 0.3.2.9002
- `rENA` 0.4.2.9003

Those development-version labels were recorded by the original oracle
environment, but no source commits, package archives, or session lock for them
are available in this repository, and that exact package environment is not
currently reconstructible here. The Yu result is therefore hash-pinned local
validation evidence, not an independently public-reproducible oracle.

The canonical parity case used the following local-only oracle inputs. These
absolute paths describe the verification environment; neither the workbook nor
the generated CSV is distributed in the npm tarball.

| Oracle artifact | Local path | SHA-256 |
|---|---|---|
| Yu coded workbook | `/Volumes/Starship/ONA/Yu_ena_coded_data_0712.xlsx` | `f2132f8dc3e147609169472594a2031130be23eab4a2ac0fb9adcb6d9d667042` |
| R ordered connection-count golden | `/Volumes/Starship/ONA/ona_output/yu_within_student/ona_connection_counts.csv` | `b4c0a6921ece7df51d846b3864e239747062da304a212aa0e2402d4a85074253` |
| Oracle harness | `/Volumes/Starship/ONA/ONA_analysis.R` | `92f309c7c3fb893c50556fee94a67b7d2c80fe9894b825cdb329ba0ab7d14e85` |

The recorded invocation was `cd /Volumes/Starship/ONA && Rscript ONA_analysis.R`
with `DATASET = "yu"`, `YU_DESIGN = "within_student"`, input and output paths
shown above, and `window_size = 2`. The harness pre-sorted input rows by
`Group`, `Name`, and numeric lesson order, then used `Group + Name` as both
analytic unit and ordered horizon; the jENA accumulator itself did not perform
that sort. It wrote the compared table as `ona_connection_counts.csv`. The
TypeScript result matched the R oracle's 87 unit
networks and 49 directed connection columns exactly: total raw connection mass
811, three zero networks, zero cell mismatches, and maximum numeric error 0.
This oracle validates ordered connection counts and schema/order for that
configuration; it does not by itself establish parity for every downstream
visualization or workflow.

The workbook and generated CSV are not redistributed by this repository or the
npm package. Their data-custodian, permission, and public-release status were
not independently established in this PR, so these hashes must not be read as
a grant of data rights or as a public reproduction route.

Because every Yu horizon has only two rows, that oracle cannot distinguish
finite windows once one preceding row is included. A separate four-row,
one-hot synthetic fixture makes the cutoff observable for three window sizes:

| Oracle artifact | Repository path | SHA-256 |
|---|---|---|
| Distinguishing tma window golden | `fixtures/goldens/ordered-window-tma.generated.json` | `0f295ed72eb360e3792d441c5e034c858ed3c65ddbbc7e868a0abdcec6f70a0e` |

The fixture was regenerated at `2026-08-23T02:53:03+0800` on
`aarch64-apple-darwin20` by `scripts/generate-ordered-window-golden.R` with R
4.4.2, tma 0.3.1, rENA 0.3.1, jsonlite 2.0.0, digest 0.6.39,
data.table 1.18.2.1, rlang 1.1.7, and Rcpp 1.1.1. Its generator script SHA-256
is `319aa82984a1b6b71f37ef61e08f1ff8288b73b5cca77b881d719bc44c72e951`.
The tma 0.3.1 oracle is GPL-3 software by Cody L Marquart, Muhammad Hasnat
Ashiq, and David Williamson Shaffer. Its pinned CRAN source archive is
[`tma_0.3.1.tar.gz`](https://cran.r-project.org/src/contrib/tma_0.3.1.tar.gz),
SHA-256
`d661721d133055f3143c79742d4da08ae2427e9ec6b576fd5c8ef69d459ee260`.
The fixture records that archive identity, relevant package versions, and
R-serialization-v2 hashes of both the body and `formals + body` definition for
every tma entry point used by the generator: `conversation_rules`, `contexts`,
`accumulate_contexts`, `decay`, and `simple_window`. The generator uses
namespace-qualified tma calls and does not load rENA into the oracle execution
path; rENA is recorded only as an installed environment version. Tests pin
those fields and keep the artifact digest above synchronized with this
document.
The fixture verifies the parameter conversion rather than claiming
equal-number parity:
`tma window_size = k` includes at most `k` preceding rows, while jENA
`windowSizeBack = k + 1` counts the current row plus those `k` preceding rows.

The current application-facing ordered contract is descriptive SVD only. It
rejects custom rotations, external rotation sets, `projectIn()`, and dense
models outside the fixed 12-code/work/matrix resource budgets. Those guards
bound the implementation that was actually reviewed; they are not claims of
official webENA feature-level parity. ONA GoF, custom rotation, and larger
multi-group non-color encoding remain separate future phases.

The ordered extension, all modifications, and the corresponding source remain
under **GPL-3.0-only**. Before any public release tag, npm publication, bundled
object-code distribution, release asset, or deployment, the release owner and
a qualified reviewer must separately confirm corresponding-source
availability, retained license/attribution notices, and the applicable
legal/license posture. Merging this source-only PR records factual repository
provenance but does not satisfy or authorize that release gate. Passing the
numerical oracle and package tests is not a substitute for it.

The npm tarball allowlist intentionally contains generated `dist/` output plus
license and documentation files; it is not itself a corresponding-source
bundle. The exact public repository commit reviewed for any object-code release
must retain the TypeScript source, tests, fixtures, lockfile, and build and
verification scripts, and recipients must be given an equivalent route to that
exact commit or tag. No npm publication or object-code release is performed by
this prerelease PR.

Packed JavaScript source maps embed `sourcesContent` for bundled runtime
modules as a debugging aid, and `pack:check` verifies that every embedded
source is byte-identical to the current repository file. The maps omit
type-only entry points and do not contain the tests, fixtures, lockfile, or
build scripts, so they are not represented as the package's corresponding-
source route.

### Exact repository source mapping for published packages

The table below records an exact public repository source commit for the listed
published package. It does not claim that a Git tag exists where none was
created.

| Published package | Exact public repository source commit |
|---|---|
| `jena-js@0.6.3` | [`57b7794ec3873c251c33086454523e5a3949836f`](https://github.com/HUDongpin/jENA/commit/57b7794ec3873c251c33086454523e5a3949836f) |

Commit `57b7794ec3873c251c33086454523e5a3949836f` remains a reachable ancestor
of this prerelease branch. Its tree contains the TypeScript source, lockfile,
build and verification scripts, tests, fixtures, and license/provenance files
associated with `jena-js@0.6.3`. This mapping is a factual repository record,
not a legal-compliance opinion. Before a future npm publication, bundled
object-code distribution, or release asset, the release owner and a qualified
reviewer must separately confirm corresponding-source availability, clear
source directions adjacent to the distributed object code, retained license
and attribution notices, and the exact object-code-to-source mapping.

## Source History

- The project descends from a local jENA template created for a browser/Node port of rENA.
- The `src/` tree was at one point reconstructed from package build sourcemaps, then completed with entrypoints, tests, scripts, and R-derived fixtures; since v0.2.0 the repository (with CI and a committed lockfile) is the canonical source of truth.
- Golden fixtures are version-stamped with the exact R/rENA/tma versions that generated them, and regeneration was verified reproducible (0 differing values at 1e-9) on R 4.4.2 / rENA 0.3.1 / tma 0.3.1 (aarch64-apple-darwin20).
- The ordered-network snapshot anchor
  `303a12f549ef9e1914cec10d6e9e1b842dad8908` is retained unchanged in
  repository history. Later candidate and integration commits must preserve it
  as an ancestor; this branch must be merged with a merge commit, not squashed,
  rebased, amended, or cherry-picked.

## Runtime Boundary

The package runtime is pure JavaScript:

- no R runtime, Rserve, or OpenCPU service is required;
- no server runtime is required for browser use;
- no framework dependency (React/Next.js) is required;
- zero runtime npm dependencies;
- the library performs **no network I/O, no filesystem access, and no persistence** — all data stays in caller memory (tests and dev-time R scripts are the only code touching disk).

R is used only for development-time tasks: regenerating golden fixtures (`npm run goldens:r`, `npm run goldens:stats`) and comparing behavior to rENA in tests.

## License

Distributed under **GPL-3.0-only**. rENA is the upstream GPL-3 work this package
translates. The root `LICENSE` is the 674-line GNU GPLv3 plain text published by
the Free Software Foundation, SHA-256
`3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`.
`.gitattributes` fixes this file to LF line endings so the canonical byte
identity remains stable across checkouts.
See the Upstream NOTICE, modification record, and source mappings above. These
records support the release gate; they do not replace review by a qualified
person for a particular distribution.
