# R Golden Fixtures

`sena-configs.generated.json` holds golden outputs generated from the upstream
`rENA` R package (accumulation, line weights, projected points, node
positions, rotation matrices, and variance for 16 model configurations across
two datasets, plus low-level kernel fixtures). The JSON is committed so parity
tests run without R in ordinary JavaScript development environments, and it
embeds a `meta` block recording the exact generation environment (R, rENA,
and tma versions, platform, timestamp, generator script) — the parity tests
assert this provenance is present.

`ordered-window-tma.generated.json` is a separate four-row synthetic oracle
whose one-hot sequence makes tma windows of one, two, and three preceding rows
produce different directed edges. It records and tests the non-identical
parameter convention explicitly: `jenaWindowSizeBack = tmaWindowSize + 1`.
Unlike the two-row Yu case, this fixture can detect an off-by-one window claim.
Its provenance block records a real generation timestamp, R platform, exact
R/tma/rENA/jsonlite/digest versions, generator path and SHA-256, the pinned
tma CRAN source archive URL and SHA-256, and installed body plus
`formals + body` definition hashes for all five tma entry points used by the
generator. The parity test pins those fields and checks that the artifact
SHA-256 remains synchronized with `PROVENANCE.md`.

## Regenerating

Requires R with the `rENA` package installed (the committed fixture was
generated with R 4.4.2 / rENA 0.3.1 / tma 0.3.1).

```bash
npm run goldens:r      # writes sena-configs.regenerated.json (never clobbers)
npm run goldens:diff   # compares regenerated vs committed at 1e-9 tolerance
npm run goldens:compare  # runs the vitest parity suite
npm run goldens:stats     # regenerates stats.generated.json (correlations, cohen's d, t/F)
npm run goldens:rotations # regenerates rotations.generated.json (regression/generalized/hena rotations)
npm run goldens:elasticnet # regenerates elasticnet.generated.json (glmnet mgaussian at fixed lambdas)
npm run goldens:ordered-window # writes ordered-window-tma.regenerated.json
```

`stats.generated.json` and `rotations.generated.json` are generated against the
same datasets (read from `sena-configs.generated.json`, plus a dedicated
12-unit dataset for `regression2`, which needs more units than adjacency
columns) and carry the same version-stamped `meta` block.

If the diff is clean (or the changes are understood and intended), replace the
committed fixture with the regenerated file in a reviewed commit:

```bash
mv fixtures/goldens/sena-configs.regenerated.json fixtures/goldens/sena-configs.generated.json
```

`regen-meta.txt` is a breadcrumb of the last regeneration run on this machine.
