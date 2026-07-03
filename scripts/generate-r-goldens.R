#!/usr/bin/env Rscript

args <- commandArgs(trailingOnly = TRUE)
out_dir <- if (length(args) >= 2) args[[2]] else if (length(args) >= 1) args[[1]] else "fixtures/goldens"

dir.create(out_dir, recursive = TRUE, showWarnings = FALSE)

if (!requireNamespace("rENA", quietly = TRUE)) {
  stop("The R package `rENA` is required to regenerate ENA golden fixtures.")
}
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("The R package `jsonlite` is required to write ENA golden fixtures.")
}

suppressPackageStartupMessages(library(rENA))

plain_df <- function(x) {
  out <- as.data.frame(x, stringsAsFactors = FALSE)
  rownames(out) <- NULL
  out
}

codes <- c("A", "B", "C", "D")
toy <- data.frame(
  unit = c("U1", "U1", "U2", "U2", "U3", "U3", "U4", "U4", "U1", "U2", "U3", "U4"),
  conv = c("C1", "C1", "C1", "C1", "C1", "C1", "C1", "C1", "C2", "C2", "C2", "C2"),
  turn = seq_len(12),
  group = c("G1", "G1", "G1", "G1", "G2", "G2", "G2", "G2", "G1", "G1", "G2", "G2"),
  A = c(1, 0, 2, 0, 1, 0, 0, 1, 0, 1, 0, 1),
  B = c(0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0),
  C = c(1, 0, 0, 2, 0, 1, 1, 0, 1, 1, 0, 0),
  D = c(0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1),
  stringsAsFactors = FALSE
)

make_accum <- function(
  model = "EndPoint",
  weight_by = "binary",
  window = "MovingStanzaWindow",
  window_size_back = 2,
  window_size_forward = 0
) {
  r_weight_by <- if (identical(weight_by, "sum")) sum else weight_by
  rENA::ena.accumulate.data(
    units = toy[, c("unit"), drop = FALSE],
    conversation = toy[, c("conv"), drop = FALSE],
    codes = toy[, codes, drop = FALSE],
    metadata = toy[, c("group"), drop = FALSE],
    model = model,
    weight.by = r_weight_by,
    window = window,
    window.size.back = window_size_back,
    window.size.forward = window_size_forward,
    include.meta = TRUE,
    as.list = TRUE
  )
}

summarize_set <- function(accum, set = NULL) {
  out <- list(
    rowConnectionCounts = plain_df(accum$model$row.connection.counts),
    connectionCounts = plain_df(accum$connection.counts),
    unitLabels = accum$model$unit.labels
  )
  if (!is.null(accum$trajectories)) {
    out$trajectories <- plain_df(accum$trajectories)
  }
  if (!is.null(set)) {
    out$lineWeights <- plain_df(set$line.weights)
    out$points <- plain_df(set$points)
    out$nodes <- plain_df(set$rotation$nodes)
    out$rotationMatrix <- plain_df(set$rotation$rotation.matrix)
    out$variance <- set$model$variance
  }
  out
}

make_config <- function(
  model = "EndPoint",
  weight_by = "binary",
  window = "MovingStanzaWindow",
  window_size_back = 2,
  window_size_forward = 0,
  rotation = NULL
) {
  accum <- make_accum(
    model = model,
    weight_by = weight_by,
    window = window,
    window_size_back = window_size_back,
    window_size_forward = window_size_forward
  )

  if (is.null(rotation)) {
    set <- rENA::ena.make.set(accum, dimensions = 2, as.list = TRUE)
  } else if (identical(rotation, "mean")) {
    set <- rENA::ena.make.set(
      accum,
      dimensions = 2,
      rotation.by = rENA::ena.rotate.by.mean,
      rotation.params = list(accum$meta.data$group == "G1", accum$meta.data$group == "G2"),
      as.list = TRUE
    )
  } else {
    stop(paste("Unknown rotation", rotation))
  }

  js_options <- list(
    model = model,
    weightBy = weight_by,
    window = window,
    windowSizeBack = window_size_back,
    windowSizeForward = window_size_forward,
    dimensions = 2
  )
  if (identical(rotation, "mean")) {
    js_options$rotation <- list(
      method = "mean",
      params = list(groups = list(list(c("U1", "U2"), c("U3", "U4"))))
    )
  }

  c(list(options = js_options), summarize_set(accum, set))
}

research_codes <- c("question", "hypothesis", "evidence", "explanation", "reflection", "coordination", "critique")
research <- data.frame(
  person = c("Ava", "Eli", "Farah", "Ben", "Chen", "Ava", "Ben", "Chen", "Eli", "Daria", "Chen", "Ava", "Farah", "Daria", "Ben", "Gia", "Hao", "Iris", "Gia", "Hao", "Iris", "Gia", "Hao", "Iris"),
  team = c(rep("Blue", 15), rep("Red", 9)),
  stanza = c("B1", "B1", "B1", "B2", "B2", "B2", "B3", "B3", "B3", "B4", "B4", "B4", "B5", "B5", "B5", "R1", "R1", "R1", "R2", "R2", "R2", "R3", "R3", "R3"),
  turn = seq_len(24),
  stage = c(rep("Brainstorming", 3), rep("Evidence Building", 6), rep("Reflection", 6), rep("Brainstorming", 3), rep("Evidence Building", 3), rep("Reflection", 3)),
  group = c(rep("Team Blue", 15), rep("Team Red", 9)),
  role = c(
    "Facilitator", "Coordinator", "Emerging contributor",
    "Evidence builder", "Concept broker", "Facilitator",
    "Evidence builder", "Concept broker", "Coordinator",
    "Reflective critic", "Concept broker", "Facilitator",
    "Emerging contributor", "Reflective critic", "Evidence builder",
    "Facilitator", "Evidence builder", "Reflective critic",
    "Facilitator", "Evidence builder", "Reflective critic",
    "Facilitator", "Evidence builder", "Reflective critic"
  ),
  question = c(1,0,1,0,0,1,0,0,0,0,0,1,0,0,0,1,0,1,0,0,0,0,0,0),
  hypothesis = c(0,0,0,0,1,0,0,0,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0,1),
  evidence = c(0,0,0,1,1,1,1,1,0,0,0,1,0,0,1,0,1,0,1,1,0,0,1,0),
  explanation = c(1,0,0,0,1,1,0,1,1,1,0,1,0,0,1,0,0,0,1,0,1,1,0,1),
  reflection = c(0,0,0,0,0,0,0,0,0,1,1,1,1,1,0,0,0,0,0,0,1,1,1,1),
  coordination = c(0,1,0,0,0,0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0,1,0,0),
  critique = c(0,0,0,0,0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0,1,0,1,1),
  stringsAsFactors = FALSE
)

make_research_accum <- function(
  model = "EndPoint",
  weight_by = "binary",
  window = "MovingStanzaWindow",
  window_size_back = 2,
  window_size_forward = 0
) {
  r_weight_by <- if (identical(weight_by, "sum")) sum else weight_by
  rENA::ena.accumulate.data(
    units = research[, c("person"), drop = FALSE],
    conversation = research[, c("team", "stanza"), drop = FALSE],
    codes = research[, research_codes, drop = FALSE],
    metadata = research[, c("group", "role"), drop = FALSE],
    model = model,
    weight.by = r_weight_by,
    window = window,
    window.size.back = window_size_back,
    window.size.forward = window_size_forward,
    include.meta = TRUE,
    as.list = TRUE
  )
}

make_research_config <- function(
  model = "EndPoint",
  weight_by = "binary",
  window = "MovingStanzaWindow",
  window_size_back = 2,
  window_size_forward = 0,
  rotation = NULL
) {
  accum <- make_research_accum(
    model = model,
    weight_by = weight_by,
    window = window,
    window_size_back = window_size_back,
    window_size_forward = window_size_forward
  )

  if (is.null(rotation)) {
    set <- rENA::ena.make.set(accum, dimensions = 2, as.list = TRUE)
  } else if (identical(rotation, "mean")) {
    set <- rENA::ena.make.set(
      accum,
      dimensions = 2,
      rotation.by = rENA::ena.rotate.by.mean,
      rotation.params = list(accum$meta.data$group == "Team Blue", accum$meta.data$group == "Team Red"),
      as.list = TRUE
    )
  } else {
    stop(paste("Unknown rotation", rotation))
  }

  js_options <- list(
    model = model,
    weightBy = weight_by,
    window = window,
    windowSizeBack = window_size_back,
    windowSizeForward = window_size_forward,
    dimensions = 2
  )
  if (identical(rotation, "mean")) {
    js_options$rotation <- list(
      method = "mean",
      params = list(groups = list(list(c("Ava", "Ben", "Chen", "Daria", "Eli", "Farah"), c("Gia", "Hao", "Iris"))))
    )
  }

  c(list(options = js_options), summarize_set(accum, set))
}

code_matrix <- as.matrix(toy[, codes])

payload <- list(
  input = plain_df(toy),
  codes = codes,
  lowLevel = list(
    rowsToCoOccurrencesBinary = unname(as.matrix(rENA:::rows_to_co_occurrences(toy[, codes], binary = TRUE))),
    rowsToCoOccurrencesWeighted = unname(as.matrix(rENA:::rows_to_co_occurrences(toy[, codes], binary = FALSE))),
    refWindowBack2 = unname(as.matrix(rENA:::ref_window_df(toy[, codes], windowSize = 2, windowForward = 0, binary = TRUE))),
    refWindowBack2Forward1 = unname(as.matrix(rENA:::ref_window_df(toy[, codes], windowSize = 2, windowForward = 1, binary = TRUE))),
    refWindowBackInf = unname(as.matrix(rENA:::ref_window_df(toy[, codes], windowSize = Inf, windowForward = 0, binary = TRUE))),
    sphereNorm = unname(as.matrix(rENA:::fun_sphere_norm(data.frame(x = c(3, 0), y = c(4, 0)))))
  ),
  configs = list(
    movingBinary = make_config(),
    movingForward = make_config(window_size_forward = 1),
    movingSum = make_config(weight_by = "sum"),
    conversationBinary = make_config(window = "Conversation"),
    accumulatedTrajectory = make_config(model = "AccumulatedTrajectory"),
    separateTrajectory = make_config(model = "SeparateTrajectory"),
    meanRotation = make_config(rotation = "mean")
  ),
  research = list(
    input = plain_df(research),
    codes = research_codes,
    configs = list(
      personMovingBinary = make_research_config(),
      personMovingForward = make_research_config(window_size_forward = 1),
      personMovingSum = make_research_config(weight_by = "sum"),
      personConversationBinary = make_research_config(window = "Conversation"),
      personAccumulatedTrajectory = make_research_config(model = "AccumulatedTrajectory"),
      personMeanRotation = make_research_config(rotation = "mean")
    )
  )
)

out_path <- file.path(out_dir, "sena-configs.generated.json")
jsonlite::write_json(payload, out_path, pretty = TRUE, auto_unbox = TRUE, digits = 16, null = "null")
message("Wrote ", out_path)
