# Ordered-network goodness of fit

Design for [issue #8](https://github.com/HUDongpin/jENA/issues/8). This document does not change source, tests, or the public API. It records the scientific contract, the reference behavior that contract has to match, and the checks an implementation would need before README, NUMERICS, or PROVENANCE could advertise an ordered goodness-of-fit (GoF) workflow.

## Current ordered model

`networkType: "ordered"` builds one directed line-weight vector per analytic unit. The vector is the full `p²` adjacency, including the diagonal. Storage is column-major:

```text
edgeIndex = responseIndex * codes.length + groundIndex
```

`makeSet` on that data is descriptive SVD only. It rejects every other rotation, `rotationSet`, and `projectIn`. The default node-position method is `"directed"`; `"undirected"` and `"directed-ground-response"` are rejected. There is no `ENA_DIRECTION` column and no second point per unit. The paired ground/response solver exists in the tree for explicitly paired rows and is not part of the ordered contract.

The resource guard in `src/core/orderedLimits.ts` is fixed: at most 12 codes (144 directed edges), estimated SVD work `units × E² + E³ ≤ 8,000,000`, and estimated dense numeric payload `8 × (3E² + 2 × units × E) ≤ 1,048,576` bytes, with `E = codes²`. At 12 codes the matrix budget binds first and admits at most 239 units. The verified Yu accumulation case is 7 codes and 87 units. The guard has no bypass. It does not budget a later correlations pass.

Directed node positions are `directedNodePositions` in `src/rotation/nodePositions.ts`. For each unit the solver builds a length-`p` weight row from the `p²` line weights, L1-normalizes it with a floor of `0.0001`, and solves `(WᵀW) X = Wᵀ P` with the unconditional ridge of `1e-10` in `solveLinearSystem`. Centroids are `W X`, then stored on the set by `centroidsAsRows`. The weight update, matching the comment in that function, is: walk the flat vector with response as the outer index and ground as the inner index; add the edge to the response node; add it to the ground node as well when the two differ. A self-loop is added once. For an edge of weight `v` from ground `g` to response `r` the incident weight is therefore

```text
w_i = (in-strength_i + out-strength_i) − self_i
```

which is every edge incident to `i`, counting a self-loop once. `A → B` and `B → A` contribute the same pair of node weights. Direction remains in the line-weight vector that SVD projects, and drops out of `W`.

`makeSet` writes `points` and `centroids` only for the displayed dimensions (`dimensions`, default 2). `variance` and `rotation.rotationMatrix` keep the full basis. Zero line-weight rows are left out of the centering mean when `centerAlignToOrigin` is true (the default) and are still present as rows. An all-zero incident row stays zero after the `0.0001` floor, so its centroid is the origin.

README states that the package does not advertise an ONA GoF workflow until that workflow has its own contract and parity tests. `enaCorrelations` does not consult `networkType`. An ordered set already carries `centroids`, so a call today runs the standard pairwise routine on those directed centroids and returns a number. That call is the silent reuse this issue exists to prevent.

## Current standard GoF

`enaCorrelations` in `src/stats.ts` is the port of `rENA::ena.correlations` described in NUMERICS. For each requested dimension it builds the `n(n−1)/2` pairwise differences of unit coordinates and the pairwise differences of centroid coordinates, in the same `(i, j)` order as R `combn` (`i` increasing, `j > i`), and computes Pearson and Spearman correlations of those two vectors. Spearman ranks come from `ranksTyped`: average ranks, ties grouped by exact `===`. A Fisher-z interval uses the pair count as `n`. rENA does not return that interval. NUMERICS treats it as descriptive. `enaStats` always calls `enaCorrelations`.

The centroid side of the standard statistic is the undirected one: half of each upper-triangle edge is given to each endpoint, then the same least-squares placement is used. NUMERICS records that this centroid, and therefore `enaCorrelations`, matches rENA 0.3.1 to 1e-9 even when individual node coordinates on a singular system only agree to about 1e-6, because a null component of `X` is annihilated by `W`.

Issue #1 is closed as not planned. On identical floats, `ranksTyped` matches R `rank()` / `cor(..., method = "spearman")`. Against rENA, solver noise on the order of 1e-8 can change which pairwise differences compare equal, and Spearman can then move by up to about 1e-4 while Pearson on the same differences stays near 1e-12. Tolerance-based tie grouping was rejected: it would chase the reference's accidental ties rather than rank jena's own geometry. Any rank-based ordered GoF inherits that rule. [PR #11](https://github.com/HUDongpin/jENA/pull/11) is an open draft that would record the bound in NUMERICS for the standard path. It is not on `main`. The decision in the issue comment stands either way.

## What the references define

The ordered reference is the `ona` package, not rENA 0.3.1. The source inspected for this design is the qe-libs tarball `ona_0.1.2.9003.tar.gz` (MD5 `8ea28fee987f50d12c5b14def670552f`, SHA-256 `172b610777a43a35616363c093af10ca569b7e9fd267f1b34b1ec901fe95f1cd`), which is the version string PROVENANCE already records for the Yu environment. That tarball's `R/correlations.R` exports `correlations(enaset, pts = NULL, cts = NULL, dims = c(1:2), direction = "response")`. The body is the same pairwise-difference Pearson and Spearman calculation as `rENA::ena.correlations`. Two ordered-specific branches sit in front of it:

- When `enaset$points` has a column `ENA_DIRECTION`, rows are kept only when that column is in `direction`. The default keeps `"response"`.
- When that column is absent, every row is kept. The comment in the function says a one-row-per-unit model has no directions to separate.

Centroids come from `enaset$model$centroids` unless the caller passes `cts`. The return value is a data frame with columns `pearson` and `spearman` and one row per requested dimension. There is no confidence interval.

`ona::model` is a wrapper around `rENA::model` with SVD as the default rotation, zero networks excluded from centering, and `center_to_origin = TRUE`. Means rotation and a supplied `rotation.set` are accepted there. Both are outside jena's ordered SVD-only phase. `ona::directed_node_optimization` calls `directed_node_positions` when the filtered points do not contain two distinct `ENA_DIRECTION` values, and `directed_node_positions_with_ground_response_added` when they do. Those two functions forward to rENA, which forwards to `libqe`.

The libqe source inspected here is `libqe_0.1.5.9000.tar.gz` (MD5 `f0f603cd7dbcfb7d0eb74f35827d2363`, SHA-256 `5d846d7f89224903157ebe309d77f15977cc17de2c4480a2bd64c716fa8ba8bd`). `qe::directed_node_positions` in `inst/include/libqe/modeling.hpp` builds node weights with the same incident-sum update as jena's directed solver, on a row-major vector whose index `i * p + j` is ground `i` to response `j` (`ona` `R/wrappers.R`). Because every off-diagonal edge is added to both endpoints and the diagonal indices coincide in row-major and column-major order, the two layouts produce the same `W` for the same directed graph. The linear solve is `solve_spd` (LAPACK Cholesky when Armadillo has LAPACK; otherwise an eigendecomposition pseudo-inverse with relative cutoff `1e-12`). That is not jena's `1e-10` ridge. Centroids are `W` times the solved nodes. The `combine_pairs = true` path is the paired ground/response model.

rENA 0.4.6.9000 (`rENA_0.4.6.9000.tar.gz`, MD5 `6bb8149abb42797e7ec22d3a03506edf`, SHA-256 `d7a55d49886125b6208836082fcae72435ce8f85456e43ba24eaa1a7a903a07b`) `optimize()` sends an `ena.ordered.set` through `directed_node_positions` and stores `positions$centroids` on the model. Its `ena.correlations` is the pairwise-difference function, reading `enaset$model$centroids`, with no direction filter. rENA 0.3.1, the pin for jena's standard goldens, is the right oracle for undirected `enaCorrelations` and the wrong oracle for an ordered model: it does not implement this directed placement.

`ona` `inst/rmd/methods_ona.rmd` fills the methods paragraph from `ona::correlations(enaset)`. The sentence it prints calls those four numbers co-registration correlations and describes node positions as the result of minimizing the difference between plotted points and network centroids. The same template can name either the ona package or the ONA web tool as the software that ran the study; the numbers in the sentence still come from the R function. That is not a captured webENA response.

Published prose uses the same co-registration story and a different formula. Tan, Ruis, Marquart, Cai, Knowles, and Shaffer, "Ordered Network Analysis," in *Advances in Quantitative Ethnography* (ICQE 2022), CCIS 1785, Springer, 2023, doi:10.1007/978-3-031-31726-2_8, say nodes are placed by the ENA optimization, which minimizes the distance between ONA scores and the centroids of the corresponding networks, and that each unit is one vector rather than the paired ground and response vectors of dENA. Bowman, Swiecki, Cai, Wang, Eagan, Linderoth, and Shaffer, "The Mathematical Foundations of Epistemic Network Analysis," ICQE 2020, CCIS 1312, Springer, 2021, doi:10.1007/978-3-030-67788-6_7, is the cited source for the undirected placement (half-weight on each endpoint). The coordinate-wise Pearson formula — correlation of the point coordinates with the centroid coordinates on that axis — is the one written out by Shaffer, Eagan, Knowles, Porter, and Cai, "Zero Re-centered Projection," ICQE 2021, CCIS 1522, Springer, 2022, doi:10.1007/978-3-030-93859-8_5, which also says ENA reports Pearson and Spearman. The packages do not compute that coordinate-wise correlation. They compute the correlation of all pairwise differences. An implementation that claims ona parity has to match `ona::correlations`, which is the pairwise form already implemented by `enaCorrelations`.

Tan, Swiecki, Ruis, and Shaffer, "Epistemic Network Analysis and Ordered Network Analysis in Learning Analytics," in *Learning Analytics Methods and Tutorials*, Springer, 2024, doi:10.1007/978-3-031-54464-4_18, tell the reader to call `ona::correlations` and show a two-by-two Pearson/Spearman table. The ona tutorial vignette on qe-libs prints the same call and the same table. Both describe fit as consistency between node positions and the model, via the same co-registration as ENA, and both point the mathematics at Bowman et al. Neither defines a second, direction-sensitive statistic.

The ENA web-tool user guide (https://bookdown.org/tan78/intro_to_ena/stats.html) documents a Goodness of Fit tab that prints Pearson and Spearman coefficients. It does not publish a separate ordered formula, a payload, or a versioned fixture. This repository has no webENA oracle. Nothing in that guide is a verification target for jena.

## Scientific contract

For a directed full-`p²` ordered network, as the reference defines it, fit on a displayed dimension is the agreement between two geometries that already exist after descriptive SVD:

1. The unit points: coordinates of the sphere-normed, centered line-weight vectors in that rotated dimension. Those vectors still carry direction.
2. The unit centroids: `W X`, where `W` is the L1-normalized incident-weight matrix above and `X` is the least-squares node placement for the displayed points. Those centroids do not carry direction.

The agreement the reference reports is Pearson and Spearman correlation of all pairwise coordinate differences, one pair of correlations per dimension. A value near 1 means that, on that axis, the ordering and spacing of units agree with the ordering and spacing of their incident-weight centroids, up to scale. That is the quantity the methods template calls co-registration, and it is the reason a reader is allowed to explain a unit's position by which codes sit on that side of the plot. It is the question the papers and the package both ask.

It is a poor question to ask of edge direction. Two units whose line weights are mirrors (`A → B` versus `B → A` with the same weight) can sit far apart in the SVD and still share a `W` row, hence the same centroid. A high correlation says the node layout explains the unit positions through incident mass. A low correlation can mean the axis is separating units by a pattern `W` cannot represent, including direction. Variance explained is the other, already implemented, question: how much of the directed line-weight matrix the rotated axis retains. The reference reports that separately and does not call it goodness of fit.

The ordered contract is therefore: report co-registration of projected points against directed-incident centroids, under an ordered name, for one point per unit, and refuse every input that would make that sentence false. Standard `enaCorrelations` stays the undirected upper-triangle statistic verified against rENA 0.3.1.

## Candidate designs

### Candidate A: co-registration on the directed centroids

**Definition.** On an ordered set produced by the current SVD path, compute the `enaCorrelations` pairwise-difference Pearson and Spearman values between `points` and `centroids`. Do not expose it by calling `enaCorrelations`. The centroid in that calculation is the directed-incident centroid `makeSet` already stores.

**Justification.** This is `ona::correlations` for a set with no `ENA_DIRECTION` column, which is the only ordered set jena can construct. The centroid is the one `libqe::directed_node_positions` returns for `combine_pairs = false`. The papers' coordinate-wise formula is not this statistic; shipping A matches the package a methods section actually calls.

**Inputs.** An `ENASet` with `networkType: "ordered"`, finite `points` and `centroids` of equal length in unit order, and dimension names that are present on both tables. Default dimensions are the displayed columns `makeSet` wrote, in rotation-column order.

**Outputs.** One Pearson and one Spearman value per dimension, in `[-1, 1]` or `NaN` when the correlation is undefined. No confidence interval: `ona::correlations` does not return one, and the pair-count Fisher interval is not a sample size.

**Failure modes.** Reject `networkType` other than `"ordered"`. Reject a missing centroid table, a length mismatch, a non-finite coordinate, and a requested dimension that is not on both tables. `enaCorrelations` currently turns a missing key or a non-finite value into `0`; the ordered function must not. Fewer than two units, or a single pair (`n = 2`), yields `NaN`, because Pearson needs at least two differences. A zero-variance difference vector yields `NaN`. All-zero units stay in the pairs. Sign of an SVD axis cancels out when points and centroids flip together, which they do when both come from the same solve.

**Ties.** Exact `===` and average ranks, shared with `ranksTyped`. No epsilon. Spearman against ona on a full pipeline is not a correctness target when the point coordinates differ. Pearson is.

**Cost.** Time and temporary memory are `Θ(n²)` in the unit count. At the guard's maximum of 239 units the pair count is 28,441 and the two difference vectors are about 450 KiB. The Yu size is 87 units and 3,741 pairs. That temporary storage is outside the SVD matrix budget and does not require a new guard. The 2000-unit correlations cost in `bench/BASELINES.md` is outside the ordered admission limit.

**Reference.** `ona` 0.1.2.9003 `correlations()` on identical point and centroid matrices, and `libqe` 0.1.5.9000 `directed_node_positions` on identical line weights and points. rENA 0.3.1 is not a reference for the centroid.

### Candidate B: a fit that keeps direction

**Definition.** Treat fit as agreement in the edge space. Let `Z` be the centered, sphere-normed `units × p²` line-weight matrix and let `V_k` be the displayed orthonormal axes. The reconstructed matrix is `Z V_k V_kᵀ`. Report, for each displayed axis or for the whole displayed subspace, the Pearson correlation between the entries of `Z` and the entries of the reconstruction (one correlation over the vectorized matrices, or one per edge column). An alternative inside the same family would replace `W` with a weight that distinguishes direction, for example out-strength alone, or a pair of positions per code, and then run the pairwise point/centroid correlation against that centroid.

**Justification.** The object SVD actually decomposes is the directed line-weight vector. A reconstruction correlation answers how much of that vector the displayed axes retain, and it still sees `A → B` as a different coordinate from `B → A`. The per-axis share of `‖ZV‖²` is the `variance` map `makeSet` already returns for the full basis. With `V` a full orthogonal basis of the edge space, `ZVVᵀ = Z`, so a correlation against the complete reconstruction is 1 whenever `Z` is nonzero. Against the displayed sub-basis the Frobenius cosine `⟨Z, ZV_k V_kᵀ⟩ / (‖Z‖ ‖ZV_k V_kᵀ‖)` is the square root of the summed displayed variance shares. Pearson correlation of the flattened entries is a further re-centering of that residual, not a new geometry.

**Inputs.** The centered line-weight matrix and the rotation, or a redesigned `W`. The current centroids are the wrong input: they have already folded each edge onto both endpoints.

**Outputs.** Correlations in the edge space, or a new centroid table plus the pairwise correlations against it. Neither shape is what `ona::correlations` returns.

**Failure modes.** A zero `Z` makes the correlation undefined. Truncation to displayed axes has to be explicit: a full orthogonal basis of the edge space reconstructs `Z`, and the null directions in that basis contribute nothing. An asymmetric `W` can be singular for different reasons than the incident-sum `W`, and the null-space argument that protects centroids has to be re-proved for that `W`. A ground/response pair of positions is the model `directed-ground-response` implements and ordered `makeSet` rejects.

**Ties.** A Pearson reconstruction correlation does not rank. A Spearman version would inherit `ranksTyped` with no reference to compare it to.

**Cost.** Vectorized correlation over `n × p²` entries is cheaper than the SVD the guard already bounds (`p² ≤ 144`, `n ≤ 239`). It does not justify raising the guard.

**Reference.** None for the number a reader would call goodness of fit. `variance` is already checked as a jena SVD property. `ona::correlations` would disagree by construction whenever direction, rather than incident mass, is what separates the units. libqe has no out-strength or two-position-per-code placement on the single-vector path.

### Candidate C: do not offer a GoF

**Definition.** Ship no ordered correlation function. Change `enaCorrelations` and `enaStats` so an ordered set throws. Leave `variance` as the only numeric summary of the SVD, and leave the directed centroids in place for plotting.

**Justification.** Candidate A's number is easy to read as "the directed model fits," and the geometry it scores has discarded direction. Closing the current footgun without publishing a replacement avoids that reading. The cost is that jena would then refuse the statistic the ona methods template prints.

**Inputs and outputs.** None. The failure mode is the point: `networkType: "ordered"` is an error from the standard stats entry points.

**Ties, cost, reference.** No rank rule and no extra memory. The reference for the refusal is this design, not ona. ona does offer the statistic.

## Recommendation

Ship candidate A, and close the footgun in the same change: `enaCorrelations` and `enaStats` reject `networkType: "ordered"`, and a new function computes the pairwise co-registration against the directed-incident centroids.

A is the statistic `ona::correlations` computes for the one-row-per-unit model jena already builds, on centroids `directedNodePositions` already defines. The implementation work is a checked entry point, a refusal on the standard entry points, and oracles for the kernel and the directed weights. B either repeats `variance` or invents a centroid the reference does not report. C is the right outcome only if the owner decides that a co-registration number on incident weights would be misread often enough that the package should not print it.

The recommendation changes if any of the following is true:

- The owner wants the published number to measure directional fidelity. That is candidate C until a reference defines the directional statistic, or candidate B if one is specified.
- A pinned `libqe::directed_node_positions` run disagrees with `directedNodePositions` on `W` for the same directed graph. A is then not verifiable until the weight or the solve is brought into line. The ridge-versus-`solve_spd` gap is expected on singular systems and is not, by itself, this disagreement.
- Ordered models gain `ENA_DIRECTION` or paired ground/response rows. The default `"response"` filter and `combine_pairs` path would become part of the contract, and they are out of scope here.
- `ona::correlations` changes, in particular if it moves from pairwise differences to the coordinate-wise Pearson formula in the papers.

## Public API sketch

Types and signatures only. Nothing here is added to `src/` by this design.

```ts
/** Co-registration of an ordered SVD set. Not a standard-ENA correlation. */
export interface OrderedNetworkCorrelation {
  dimension: string;
  pearson: number;
  spearman: number;
  /** Centroid side of the correlation. Fixed for this contract. */
  centroid: "directed-incident";
}

export function orderedNetworkCorrelations(
  set: ENASet,
  dims?: Array<number | string>
): OrderedNetworkCorrelation[];
```

`dims` entries are 1-based positions in the displayed rotation columns, or column names, matching `enaCorrelations`. The default is every displayed dimension stored on `points`, in that order. The result carries `centroid: "directed-incident"` so a caller cannot pass the object off as an undirected ENA GoF table. There is no `confLevel` and no interval.

The function throws in these cases:

- `set.networkType !== "ordered"`, with a message that names `enaCorrelations` as the standard-ENA function.
- `centroids` is missing, or its length differs from `points`.
- A point or centroid coordinate on a requested dimension is not a finite number.
- A requested dimension is not present on both `points` and `centroids`. Dimensions that exist only on `rotation.rotationMatrix` are not available; `makeSet` did not store them on the point table.

There is no `direction` argument, no rotation argument, and no raw-matrix argument. The paired `"response"` filter has nothing to select on a one-row-per-unit set.

`enaCorrelations` throws when `set.networkType === "ordered"`, with a message that names `orderedNetworkCorrelations`. `enaStats` calls `enaCorrelations` today, so the same throw covers it until a separate ordered summary contract exists. Group tests on ordered points are not part of this design.

The function reads the centroids on the set. It does not re-solve nodes and it does not accept a substitute weight matrix. An ordered set from `makeSet` has only the directed centroids. The export belongs on the root entry, next to `enaCorrelations`, only once the verification plan below is in the tree. Until those tests exist the symbol stays unexported.

## Verification plan

Three layers, because a single golden against rENA 0.3.1 cannot see the directed centroid.

**Kernel.** Build point and centroid matrices in R, call `ona::correlations(enaset, pts, cts)` (the arguments skip the `ENA_DIRECTION` branch), and call the new function on an ordered set that contains only those columns. Require Pearson and Spearman to agree to 1e-9, including exact ties, all-equal columns (`NaN`), `n < 2`, and `n = 2`. This oracle is `ona` 0.1.2.9003. On identical floats the existing `ranksTyped` path is already the R average-rank rule, so this layer is a contract test of wiring and of the refusal cases as much as of the arithmetic.

**Directed weights and centroids.** For synthetic full-`p²` line weights and points, compare jena's incident `W` to `libqe::directed_node_positions` (`libqe` 0.1.5.9000) after aligning column-major and row-major layouts. The two loops add the same edges into each node, in a different order, so exact binary weights should agree to 0 and general finite weights should agree to a few ulps. The cases that have to be in the fixture are a self-loop, a one-way edge, and its reverse. Centroids on a well-conditioned `WᵀW` should then be compared at the undirected correlations bound, 1e-9; if the `1e-10` ridge versus `solve_spd` misses that bound, the test records the observed gap rather than loosening `W`. On a deliberately singular `W`, node coordinates follow the undirected bound in NUMERICS (4e-6 + 2e-6·|value|). Centroid agreement on that singular system is measured and written down; it is not copied from the undirected goldens in advance. Spearman is not asserted in this layer.

**End-to-end.** A small public synthetic corpus, accumulated with the existing rule `jENA windowSizeBack = tma window_size + 1`, modeled with SVD, and compared on Pearson only, after per-axis sign alignment. The generator pins ona, tma, rENA, and libqe by tarball hash the way `fixtures/goldens/ordered-window-tma.generated.json` pins tma 0.3.1. The Pearson bound is whatever that fixture measures; it is not declared 1e-9 in advance. Spearman is reported in the fixture and is not a pass/fail against R, for the reason in issue #1. The committed tma window golden does not contain points, nodes, or correlations, so it cannot be reused as this oracle.

The Yu workbook and `ona_connection_counts.csv` stay what PROVENANCE says they are: a local, non-redistributable check of connection counts for 87 units. They do not record centroids or correlations, and the ona/tma/rENA builds that produced them are not reconstructible here. They are not a GoF oracle.

Property tests that do not need R: the correlation is unchanged if both the point column and the centroid column are multiplied by −1; it changes sign if only one of them is; a standard set and an ordered set passed to the other function throw; a dimension absent from `points` throws; swapping `A → B` and `B → A` in one unit changes the point and leaves that unit's `W` row unchanged.

**What cannot be verified.**

- Numeric parity with webENA. No response payload or tool version is in the repository. The methods template's web-tool wording is not a substitute.
- Parity with the Yu session, or with rENA 0.4.2.9003 as used in that session.
- Spearman against ona whenever the coordinates are not the same floats.
- Means rotation, `rotation.set`, and `projectIn` on ordered data. Those inputs are rejected before a set exists.
- The coordinate-wise formula in the papers. Matching it would fail `ona::correlations`.
- A claim that a high value means the arrows, as opposed to the incident codes, explain the axis.

## Documentation and status once implemented

README's ordered section can drop GoF from the list of workflows the package refuses, and only that item. The sentence about generic APIs stays. The verified-tier table gains a row for `orderedNetworkCorrelations` whose status is the synthetic ona/libqe contract, not "verified against rENA 0.3.1." The standard `enaCorrelations` row keeps its rENA 0.3.1 note and gains a clause that ordered sets are rejected. Directed node positions stay on their current row unless the new centroid comparison upgrades that row; a GoF test is not by itself an upgrade of the node-position solver.

NUMERICS gains a short ordered-GoF section: the pairwise-difference definition, the incident-weight centroid, column-major versus row-major invariance of `W`, the ridge versus `solve_spd`, the exact-tie rule and the ~1e-4 Spearman caveat from issue #1, and the statement that no Fisher interval is returned. The standard bullet stays the rENA 0.3.1 bullet.

PROVENANCE records the ona, libqe, rENA, and tma tarball hashes of the end-to-end generator, on the same pattern as the tma 0.3.1 pin. It states that the Yu hashes still do not cover GoF, and that the feature is not webENA parity. The paragraph that lists ONA GoF as a future phase is updated only when the tests land.

`enaCorrelations` remains attributed to `R/ena.correlations.R`. The new function is attributed to `ona` `R/correlations.R` plus `libqe` `directed_node_positions`, as a checked use of those definitions, not as a line-by-line port of the ona package.

## Open questions

1. Confirm candidate A. The alternative that drops the number entirely is candidate C. That choice is the owner's, because it decides what a later methods sentence is allowed to claim.
2. Should the result include the descriptive Fisher-z interval that `enaCorrelations` already computes? This design leaves it out so the columns match `ona::correlations`.
3. `enaStats` on an ordered set. This design rejects the whole call, because the call always computes standard GoF. Dimension summaries and group tests of ordered points need their own contract if they are kept.
4. Is a public synthetic end-to-end fixture enough? The Yu files cannot be added to the repository and do not contain the statistic.
5. Which tool versions does the owner want pinned for that fixture? This design uses the public ona 0.1.2.9003 sources above, plus whatever tma/rENA/libqe those sources import at generation time. That set is not the Yu environment (tma 0.3.2.9002, rENA 0.4.2.9003).
6. The export name. `orderedNetworkCorrelations` matches `networkType: "ordered"`. `accumulate` already rejects the string `"ona"`.

## Non-goals

- Custom rotation for the ordered product contract ([issue #9](https://github.com/HUDongpin/jENA/issues/9)). Means rotation and `rotation.set` stay rejected. Candidate A does not read a rotation method off the set beyond the points and centroids SVD `makeSet` stored.
- Larger multi-group non-color encoding ([issue #10](https://github.com/HUDongpin/jENA/issues/10)).
- A webENA feature-parity claim, a 3D renderer, a trajectory view, a forward window, or the paired ground/response model.
- Changing `ranksTyped`, the standard ENA goldens, or the ordered resource guard.
