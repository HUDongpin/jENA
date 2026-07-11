# generate-elasticnet-goldens.R
# Golden coefficients from glmnet's multivariate-gaussian elastic net at
# FIXED lambda values. rENA's multi-covariate generalized rotation selects
# lambda via cv.glmnet with randomized folds (not reproducible even across
# rENA runs), but the SOLVER itself is deterministic given lambda — these
# goldens verify jena's coordinate descent against it. The X/Y matrices are
# embedded in the fixture so both sides use byte-identical inputs.
# Run: Rscript scripts/generate-elasticnet-goldens.R [project_dir]
# Writes fixtures/goldens/elasticnet.generated.json

cli_args <- commandArgs(trailingOnly = TRUE)
file_arg <- grep("^--file=", commandArgs(trailingOnly = FALSE), value = TRUE)
script_dir <- if (length(file_arg) > 0) {
  dirname(normalizePath(sub("^--file=", "", file_arg[[1]])))
} else {
  NA_character_
}
project_dir <- if (length(cli_args) >= 1) {
  normalizePath(cli_args[[1]])
} else if (!is.na(script_dir)) {
  dirname(script_dir)
} else {
  getwd()
}

suppressPackageStartupMessages({
  library(jsonlite)
  library(glmnet)
  library(rENA)
})

fixture <- jsonlite::read_json(
  file.path(project_dir, "fixtures", "goldens", "rotations.generated.json"),
  simplifyVector = TRUE
)

# Build Y from the regression2 dataset's centered projection points and X
# from simple deterministic encodings of its metadata.
reg2 <- fixture$regression2
accum <- rENA::ena.accumulate.data(
  units = reg2$input[, "unit", drop = FALSE],
  conversation = reg2$input[, "conv", drop = FALSE],
  codes = reg2$input[, reg2$codes, drop = FALSE],
  metadata = reg2$input[, c("grp", "lvl"), drop = FALSE],
  model = "EndPoint", weight.by = "binary", window = "MovingStanzaWindow",
  window.size.back = 2, window.size.forward = 0,
  include.meta = TRUE, as.list = TRUE
)
set <- rENA::ena.make.set(accum, dimensions = 2, as.list = TRUE)
Y <- unname(as.matrix(set$model$points.for.projection))

meta <- set$model$points.for.projection
grp01 <- as.numeric(as.factor(meta$grp)) - 1
lvl123 <- as.numeric(as.factor(meta$lvl))
n <- nrow(Y)
X <- unname(cbind(grp01, lvl123, grp01 * lvl123, seq_len(n) / n))

fit_case <- function(alpha, penalty_factor, standardize, lambdas) {
  fit <- glmnet::glmnet(
    x = X, y = Y, family = "mgaussian",
    alpha = alpha, lambda = lambdas,
    penalty.factor = penalty_factor,
    standardize = standardize, intercept = TRUE,
    thresh = 1e-14, maxit = 1e7
  )
  list(
    alpha = alpha,
    penaltyFactor = penalty_factor,
    standardize = standardize,
    lambdas = lambdas,
    # a0: K x nlambda; beta: per-response p x nlambda
    intercepts = lapply(seq_along(lambdas), function(i) unname(fit$a0[, i])),
    coefficients = lapply(seq_along(lambdas), function(i) {
      lapply(fit$beta, function(b) unname(as.matrix(b)[, i]))
    })
  )
}

lambdas <- c(0.5, 0.1, 0.02, 0.004)

payload <- list(
  meta = list(
    generatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
    rVersion = R.version.string,
    platform = R.version$platform,
    glmnetVersion = as.character(utils::packageVersion("glmnet")),
    generatorScript = "scripts/generate-elasticnet-goldens.R"
  ),
  x = X,
  y = Y,
  cases = list(
    gmrShape = fit_case(1, c(0, 1, 1, 1), TRUE, lambdas),
    allPenalized = fit_case(1, c(1, 1, 1, 1), TRUE, lambdas),
    unstandardized = fit_case(1, c(0, 1, 1, 1), FALSE, lambdas),
    elasticMix = fit_case(0.5, c(1, 1, 1, 1), TRUE, lambdas)
  )
)

out_path <- file.path(project_dir, "fixtures", "goldens", "elasticnet.generated.json")
jsonlite::write_json(payload, out_path, pretty = TRUE, auto_unbox = TRUE, digits = 16, null = "null")
message("wrote: ", out_path)
