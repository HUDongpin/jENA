# generate-stats-goldens.R
# Golden values for the stats module, generated from the installed rENA
# package on the SAME datasets as the main parity fixture (read from
# sena-configs.generated.json so the inputs cannot drift apart).
# Run: Rscript scripts/generate-stats-goldens.R [project_dir]
# Writes fixtures/goldens/stats.generated.json

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
  library(rENA)
})

fixture <- jsonlite::read_json(
  file.path(project_dir, "fixtures", "goldens", "sena-configs.generated.json"),
  simplifyVector = TRUE
)

meta <- list(
  generatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z"),
  rVersion = R.version.string,
  platform = R.version$platform,
  rENAVersion = as.character(utils::packageVersion("rENA")),
  generatorScript = "scripts/generate-stats-goldens.R"
)

make_set <- function(input, codes, units, conversation, metadata) {
  accum <- rENA::ena.accumulate.data(
    units = input[, units, drop = FALSE],
    conversation = input[, conversation, drop = FALSE],
    codes = input[, codes, drop = FALSE],
    metadata = input[, metadata, drop = FALSE],
    model = "EndPoint", weight.by = "binary", window = "MovingStanzaWindow",
    window.size.back = 2, window.size.forward = 0,
    include.meta = TRUE, as.list = TRUE
  )
  rENA::ena.make.set(accum, dimensions = 2, as.list = TRUE)
}

# Pearson CI reference values follow the same Fisher-z construction the JS
# library documents (pair count as n); rENA itself reports no CI.
fisher_ci <- function(r, n_pairs, conf_level = 0.95) {
  z <- atanh(r)
  sigma <- 1 / sqrt(n_pairs - 3)
  q <- qnorm((1 + conf_level) / 2)
  c(tanh(z - sigma * q), tanh(z + sigma * q))
}

summarize_stats <- function(set, group_column, group_levels, anova_column) {
  cors <- rENA::ena.correlations(set)
  pearson <- unlist(cors$pearson)
  spearman <- unlist(cors$spearman)
  points <- set$points
  n_pairs <- choose(nrow(points), 2)
  ci <- lapply(pearson, fisher_ci, n_pairs = n_pairs)

  left <- points$SVD1[points[[group_column]] == group_levels[[1]]]
  right <- points$SVD1[points[[group_column]] == group_levels[[2]]]
  left2 <- points$SVD2[points[[group_column]] == group_levels[[1]]]
  right2 <- points$SVD2[points[[group_column]] == group_levels[[2]]]
  welch <- t.test(left, right)

  out <- list(
    correlations = list(
      dimensions = c("SVD1", "SVD2"),
      pearson = pearson,
      spearman = spearman,
      pearsonLower = vapply(ci, `[[`, numeric(1), 1),
      pearsonUpper = vapply(ci, `[[`, numeric(1), 2),
      pairCount = n_pairs
    ),
    cohensD = list(
      groupColumn = group_column,
      groups = group_levels,
      SVD1 = rENA::fun_cohens.d(left, right),
      SVD2 = rENA::fun_cohens.d(left2, right2)
    ),
    welch = list(
      groupColumn = group_column,
      groups = group_levels,
      dimension = "SVD1",
      statistic = unname(welch$statistic),
      df = unname(welch$parameter)
    )
  )

  if (!is.null(anova_column)) {
    frame <- data.frame(y = points$SVD1, g = factor(points[[anova_column]]))
    fit <- summary(aov(y ~ g, data = frame))[[1]]
    out$anova <- list(
      groupColumn = anova_column,
      dimension = "SVD1",
      statistic = fit$`F value`[[1]],
      dfBetween = fit$Df[[1]],
      dfWithin = fit$Df[[2]]
    )
  }
  out
}

toy_set <- make_set(fixture$input, fixture$codes, "unit", "conv", "group")
research_set <- make_set(
  fixture$research$input, fixture$research$codes,
  "person", c("team", "stanza"), c("group", "role")
)

payload <- list(
  meta = meta,
  qnorm = list(
    p = c(1e-4, 0.001, 0.01, 0.025, 0.05, 0.1, 0.5, 0.9, 0.975, 0.999, 0.9999),
    value = qnorm(c(1e-4, 0.001, 0.01, 0.025, 0.05, 0.1, 0.5, 0.9, 0.975, 0.999, 0.9999))
  ),
  toy = summarize_stats(toy_set, "group", list("G1", "G2"), NULL),
  research = summarize_stats(research_set, "group", list("Team Blue", "Team Red"), "role")
)

out_path <- file.path(project_dir, "fixtures", "goldens", "stats.generated.json")
jsonlite::write_json(payload, out_path, pretty = TRUE, auto_unbox = TRUE, digits = 16, null = "null")
message("wrote: ", out_path)
