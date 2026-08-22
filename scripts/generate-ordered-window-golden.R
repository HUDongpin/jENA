#!/usr/bin/env Rscript

# Regenerates the synthetic ordered-window fixture used to distinguish tma's
# `window_size` parameter from jena-js's `windowSizeBack` parameter. The input
# has four one-hot rows in one horizon, so windows of one, two, and three prior
# rows produce visibly different directed edges.

if (!requireNamespace("tma", quietly = TRUE)) {
  stop('Package "tma" is required to regenerate the ordered-window golden.')
}
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop('Package "jsonlite" is required to regenerate the ordered-window golden.')
}
if (!requireNamespace("digest", quietly = TRUE)) {
  stop('Package "digest" is required to record the oracle source hashes.')
}
rena_package_path <- find.package("rENA", quiet = TRUE)
if (length(rena_package_path) == 0L) {
  stop('Package "rENA" is required to record the regeneration environment.')
}
if (isNamespaceLoaded("rENA")) {
  stop('The rENA namespace must not be preloaded; run this script with Rscript --vanilla.')
}

args <- commandArgs(trailingOnly = TRUE)
output_path <- if (length(args) >= 1) args[[1]] else
  "fixtures/goldens/ordered-window-tma.regenerated.json"
generator_script <- "scripts/generate-ordered-window-golden.R"
if (!file.exists(generator_script)) {
  stop(paste("Run this generator from the repository root; missing", generator_script))
}

tma_version <- as.character(packageVersion("tma"))
rena_version <- as.character(packageVersion("rENA"))
if (tma_version != "0.3.1" || rena_version != "0.3.1") {
  stop("This pinned oracle requires exactly tma 0.3.1 and rENA 0.3.1.")
}

tma_source_archive_url <-
  "https://cran.r-project.org/src/contrib/tma_0.3.1.tar.gz"
tma_source_archive_sha256 <-
  "d661721d133055f3143c79742d4da08ae2427e9ec6b576fd5c8ef69d459ee260"
tma_functions <- c(
  "conversation_rules",
  "contexts",
  "accumulate_contexts",
  "decay",
  "simple_window"
)
tma_definition_hash <- function(value) {
  digest::digest(
    value,
    algo = "sha256",
    serialize = TRUE,
    ascii = FALSE,
    serializeVersion = 2L
  )
}
tma_function_body_sha256 <- lapply(tma_functions, function(function_name) {
  tma_definition_hash(body(getExportedValue("tma", function_name)))
})
names(tma_function_body_sha256) <- tma_functions
tma_function_definition_sha256 <- lapply(tma_functions, function(function_name) {
  function_value <- getExportedValue("tma", function_name)
  tma_definition_hash(
    list(formals = formals(function_value), body = body(function_value))
  )
})
names(tma_function_definition_sha256) <- tma_functions

codes <- c("A", "B", "C", "D")
rows <- data.frame(
  unit = rep("u1", 4),
  horizon = rep("h1", 4),
  A = c(1, 0, 0, 0),
  B = c(0, 1, 0, 0),
  C = c(0, 0, 1, 0),
  D = c(0, 0, 0, 1),
  check.names = FALSE
)

hoo <- tma::conversation_rules(
  (unit %in% UNIT$unit & horizon %in% UNIT$horizon)
)

generate_case <- function(window_size) {
  accumulated <- suppressWarnings(
    tma::contexts(rows, units_by = "unit", hoo_rules = hoo) |>
      tma::accumulate_contexts(
        codes = codes,
        decay.function = tma::decay(tma::simple_window, window_size = window_size),
        weight.by = base::sum,
        norm.by = NULL,
        return.ena.set = FALSE
      )
  )
  counts <- as.data.frame(accumulated$connection.counts)
  edge_columns <- setdiff(names(counts), c("unit", "ENA_UNIT"))
  list(
    tmaWindowSize = window_size,
    jenaWindowSizeBack = window_size + 1,
    connectionCounts = unname(as.numeric(counts[1, edge_columns]))
  )
}

fixture <- list(
  schemaVersion = 2,
  generatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
  generator = list(
    r = R.version.string,
    platform = R.version$platform,
    tma = tma_version,
    rENA = rena_version,
    jsonlite = as.character(packageVersion("jsonlite")),
    digest = as.character(packageVersion("digest")),
    dataTable = as.character(packageVersion("data.table")),
    rlang = as.character(packageVersion("rlang")),
    Rcpp = as.character(packageVersion("Rcpp")),
    tmaSourceArchiveUrl = tma_source_archive_url,
    tmaSourceArchiveSha256 = tma_source_archive_sha256,
    generatorScript = generator_script,
    generatorScriptSha256 = digest::digest(file = generator_script, algo = "sha256"),
    functionHashSpec = "sha256:R-serialize-v2:ascii=false",
    tmaFunctionBodySha256 = tma_function_body_sha256,
    tmaFunctionDefinitionSha256 = tma_function_definition_sha256
  ),
  parameterMapping = list(
    tmaWindowSize = "maximum preceding rows",
    jenaWindowSizeBack = "current row plus maximum preceding rows",
    equation = "jenaWindowSizeBack = tmaWindowSize + 1"
  ),
  codes = unname(codes),
  rows = rows,
  codeColumns = c(
    "A & A", "B & A", "C & A", "D & A",
    "A & B", "B & B", "C & B", "D & B",
    "A & C", "B & C", "C & C", "D & C",
    "A & D", "B & D", "C & D", "D & D"
  ),
  cases = lapply(1:3, generate_case)
)

json <- jsonlite::toJSON(
  fixture,
  auto_unbox = TRUE,
  dataframe = "rows",
  pretty = TRUE,
  digits = NA
)
writeLines(json, con = output_path, useBytes = TRUE)
