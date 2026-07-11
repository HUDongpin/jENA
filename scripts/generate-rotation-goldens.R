# generate-rotation-goldens.R
# Golden values for the regression / regression_2 / generalized rotations,
# generated from the installed rENA package on the SAME datasets as the main
# parity fixture (read from sena-configs.generated.json so inputs cannot
# drift). Only DETERMINISTIC rotation paths are captured: multi-covariate
# generalized rotations go through cv.glmnet (randomized folds) and cannot be
# golden-tested.
# Run: Rscript scripts/generate-rotation-goldens.R [project_dir]
# Writes fixtures/goldens/rotations.generated.json

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
  generatorScript = "scripts/generate-rotation-goldens.R"
)

plain_df <- function(x) {
  out <- as.data.frame(x, stringsAsFactors = FALSE)
  rownames(out) <- NULL
  out
}

make_accum <- function(input, codes, units, conversation, metadata) {
  rENA::ena.accumulate.data(
    units = input[, units, drop = FALSE],
    conversation = input[, conversation, drop = FALSE],
    codes = input[, codes, drop = FALSE],
    metadata = input[, metadata, drop = FALSE],
    model = "EndPoint", weight.by = "binary", window = "MovingStanzaWindow",
    window.size.back = 2, window.size.forward = 0,
    include.meta = TRUE, as.list = TRUE
  )
}

summarize_rotation_set <- function(accum, set, js_rotation) {
  rotation_matrix <- plain_df(set$rotation$rotation.matrix)
  # In the two-formula case R's cbind inherits rownames from the coefficient
  # vector, which lm prefixes with the response-matrix name ("VA & B").
  # Normalize to the actual adjacency column names.
  rotation_matrix$codes <- colnames(as.matrix(set$model$points.for.projection))
  list(
    options = list(
      model = "EndPoint", weightBy = "binary", window = "MovingStanzaWindow",
      windowSizeBack = 2, windowSizeForward = 0, dimensions = 2,
      rotation = js_rotation
    ),
    unitLabels = accum$model$unit.labels,
    points = plain_df(set$points),
    nodes = plain_df(set$rotation$nodes),
    rotationMatrix = rotation_matrix,
    rotationColumnNames = setdiff(colnames(rotation_matrix), "codes"),
    variance = set$model$variance
  )
}

make_rotation_config <- function(accum, rotation_by, rotation_params, js_rotation) {
  set <- rENA::ena.make.set(
    accum, dimensions = 2,
    rotation.by = rotation_by,
    rotation.params = rotation_params,
    as.list = TRUE
  )
  summarize_rotation_set(accum, set, js_rotation)
}

toy_accum <- make_accum(fixture$input, fixture$codes, "unit", "conv", "group")
research_accum <- make_accum(
  fixture$research$input, fixture$research$codes,
  "person", c("team", "stanza"), c("group", "role")
)

# regression_2 regresses the target on ALL point columns, so it needs more
# units than adjacency columns (research: 9 units x 21 columns is
# rank-deficient and rENA itself returns NA coefficients). Dedicated dataset:
# 12 units x 3 codes (3 adjacency columns).
reg2_units <- sprintf("u%02d", 1:12)
reg2_codes <- c("A", "B", "C")
reg2_pattern <- list(
  c(1,0,1, 0,1,1), c(1,1,0, 0,0,1), c(0,1,0, 1,0,1), c(1,0,0, 1,1,1),
  c(0,1,1, 1,1,0), c(1,0,1, 0,1,0), c(0,0,1, 1,1,0), c(1,1,1, 0,1,0),
  c(0,1,0, 1,0,0), c(1,0,1, 1,1,0), c(0,1,1, 1,0,1), c(1,1,0, 1,0,1)
)
reg2_data <- do.call(rbind, lapply(seq_along(reg2_units), function(i) {
  p <- reg2_pattern[[i]]
  data.frame(
    unit = rep(reg2_units[[i]], 2),
    conv = "c1",
    grp = rep(if (i <= 6) "GA" else "GB", 2),
    lvl = rep(c("L", "M", "N")[[((i - 1) %% 3) + 1]], 2),
    A = c(p[[1]], p[[4]]), B = c(p[[2]], p[[5]]), C = c(p[[3]], p[[6]]),
    stringsAsFactors = FALSE
  )
}))
reg2_accum <- make_accum(reg2_data, reg2_codes, "unit", "conv", c("grp", "lvl"))

payload <- list(
  meta = meta,
  toy = list(
    configs = list(
      regressionX = make_rotation_config(
        toy_accum, rENA::ena.rotate.by.hena.regression,
        list(x_var = "V ~ group"),
        list(method = "regression", params = list(xVar = "V ~ group"))
      ),
      generalizedX = make_rotation_config(
        toy_accum, rENA::ena.rotate.by.generalized,
        list(x_var = toy_accum$meta.data[, "group", with = FALSE]),
        list(method = "generalized", params = list(xVar = "group"))
      ),
      henaX = make_rotation_config(
        toy_accum, rENA::ena.rotation.h,
        list(x_var = "group"),
        list(method = "hena", params = list(xVar = "group"))
      )
    )
  ),
  research = list(
    configs = list(
      regressionX = make_rotation_config(
        research_accum, rENA::ena.rotate.by.hena.regression,
        list(x_var = "V ~ group"),
        list(method = "regression", params = list(xVar = "V ~ group"))
      ),
      regressionXY = make_rotation_config(
        research_accum, rENA::ena.rotate.by.hena.regression,
        list(x_var = "V ~ group", y_var = "V ~ role"),
        list(method = "regression", params = list(xVar = "V ~ group", yVar = "V ~ role"))
      ),
      regressionControls = make_rotation_config(
        research_accum, rENA::ena.rotate.by.hena.regression,
        list(x_var = "V ~ group + role + group:role"),
        list(method = "regression", params = list(xVar = "V ~ group + role + group:role"))
      ),
      generalizedX = make_rotation_config(
        research_accum, rENA::ena.rotate.by.generalized,
        list(x_var = research_accum$meta.data[, "group", with = FALSE]),
        list(method = "generalized", params = list(xVar = "group"))
      ),
      generalizedXY = make_rotation_config(
        research_accum, rENA::ena.rotate.by.generalized,
        list(
          x_var = research_accum$meta.data[, "group", with = FALSE],
          y_var = research_accum$meta.data[, "role", with = FALSE]
        ),
        list(method = "generalized", params = list(xVar = "group", yVar = "role"))
      ),
      generalizedSelect2 = make_rotation_config(
        research_accum, rENA::ena.rotate.by.generalized,
        list(
          x_var = research_accum$meta.data[, "role", with = FALSE],
          select_2_groups = list("Facilitator", "Evidence builder")
        ),
        list(method = "generalized", params = list(xVar = "role", select2Groups = list("Facilitator", "Evidence builder")))
      ),
      henaX = make_rotation_config(
        research_accum, rENA::ena.rotation.h,
        list(x_var = "group"),
        list(method = "hena", params = list(xVar = "group"))
      ),
      henaXY = make_rotation_config(
        research_accum, rENA::ena.rotation.h,
        list(x_var = "group", y_var = "role"),
        list(method = "hena", params = list(xVar = "group", yVar = "role"))
      ),
      henaControls = make_rotation_config(
        research_accum, rENA::ena.rotation.h,
        list(x_var = "group", control_vars = c("role")),
        list(method = "hena", params = list(xVar = "group", controlVars = list("role")))
      ),
      henaInteraction = make_rotation_config(
        research_accum, rENA::ena.rotation.h,
        list(x_var = "group", y_var = "role", include_xy = TRUE),
        list(method = "hena", params = list(xVar = "group", yVar = "role", includeXY = TRUE))
      ),
      henaNoCentering = make_rotation_config(
        research_accum, rENA::ena.rotation.h,
        list(x_var = "group", y_var = "role", include_xy = TRUE, centering = FALSE),
        list(method = "hena", params = list(xVar = "group", yVar = "role", includeXY = TRUE, centering = FALSE))
      )
    )
  ),
  regression2 = list(
    input = plain_df(reg2_data),
    codes = reg2_codes,
    units = "unit",
    conversation = "conv",
    metadata = c("grp", "lvl"),
    configs = list(
      regression2X = make_rotation_config(
        reg2_accum, rENA::ena.rotate.by.hena.regression_2,
        list(x_var = "grp ~ V"),
        list(method = "regression2", params = list(xVar = "grp ~ V"))
      ),
      regression2XY = make_rotation_config(
        reg2_accum, rENA::ena.rotate.by.hena.regression_2,
        list(x_var = "grp ~ V", y_var = "lvl ~ V"),
        list(method = "regression2", params = list(xVar = "grp ~ V", yVar = "lvl ~ V"))
      ),
      regressionX = make_rotation_config(
        reg2_accum, rENA::ena.rotate.by.hena.regression,
        list(x_var = "V ~ grp"),
        list(method = "regression", params = list(xVar = "V ~ grp"))
      ),
      regressionXY = make_rotation_config(
        reg2_accum, rENA::ena.rotate.by.hena.regression,
        list(x_var = "V ~ grp", y_var = "V ~ lvl"),
        list(method = "regression", params = list(xVar = "V ~ grp", yVar = "V ~ lvl"))
      )
    )
  )
)

out_path <- file.path(project_dir, "fixtures", "goldens", "rotations.generated.json")
jsonlite::write_json(payload, out_path, pretty = TRUE, auto_unbox = TRUE, digits = 16, null = "null")
message("wrote: ", out_path)
