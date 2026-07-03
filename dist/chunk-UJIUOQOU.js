// src/plot/network.ts
function networkFromConnectionRow(row, codes, adjacencyKey, minWeight = 0) {
  const nodes = codes.map((code) => ({ id: code, label: code }));
  const edges = adjacencyKey.map((edge) => ({
    source: edge.source,
    target: edge.target,
    name: edge.name,
    weight: Number(row[edge.name] ?? 0)
  })).filter((edge) => Math.abs(edge.weight) > minWeight);
  return { nodes, edges };
}

// src/plot/model.ts
var defaultPalette = ["#3366cc", "#dc3912", "#ff9900", "#109618", "#990099", "#0099c6", "#dd4477", "#66aa00"];
function dimensionPair(set, dimensions) {
  return dimensions ?? [set.rotation.rotationColumns[0] ?? "SVD1", set.rotation.rotationColumns[1] ?? "SVD2"];
}
function numeric(row, column) {
  const value = Number(row[column] ?? 0);
  return Number.isFinite(value) ? value : 0;
}
function pointsFromRows(rows, dimensions) {
  return rows.map((row) => ({ x: numeric(row, dimensions[0]), y: numeric(row, dimensions[1]), label: String(row.ENA_UNIT ?? row.unit ?? row.code ?? ""), row }));
}
function rangeFromValues(values, padding) {
  const max = Math.max(1e-9, ...values.map((value) => Math.abs(value))) * padding;
  return [-max, max];
}
function defaultAxisRange(set, dimensions, options) {
  const padding = options.axisPadding ?? 1.2;
  if (typeof options.scaleTo === "number") return { x: [-options.scaleTo, options.scaleTo], y: [-options.scaleTo, options.scaleTo] };
  if (typeof options.scaleTo === "object") {
    const fallback = defaultAxisRange(set, dimensions, { ...options, scaleTo: "network" });
    return { x: options.scaleTo.x ?? fallback.x, y: options.scaleTo.y ?? fallback.y };
  }
  const source = options.scaleTo === "points" ? set.points : set.rotation.nodes ?? set.points;
  return {
    x: rangeFromValues(source.map((row) => numeric(row, dimensions[0])), padding),
    y: rangeFromValues(source.map((row) => numeric(row, dimensions[1])), padding)
  };
}
function matchesSelector(row, selector) {
  if (!selector) return true;
  if (typeof selector === "function") return selector(row);
  return Object.entries(selector).every(([key, value]) => row[key] === value);
}
function nextColor(model, explicit) {
  return explicit ?? model.palette[model.traces.length % model.palette.length] ?? "#3366cc";
}
function isNetworkGraph(value) {
  return Boolean(value && Array.isArray(value.nodes) && Array.isArray(value.edges));
}
function networkWithNodePositions(network, set, dimensions) {
  const positions = new Map((set.rotation.nodes ?? []).map((row) => [
    String(row.code ?? row.id ?? row.label ?? ""),
    { x: numeric(row, dimensions[0]), y: numeric(row, dimensions[1]) }
  ]));
  return {
    nodes: network.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, ...position } : node;
    }),
    edges: network.edges
  };
}
function createENAPlotModel(set, options = {}) {
  const dimensions = dimensionPair(set, options.dimensions);
  const axes = defaultAxisRange(set, dimensions, options);
  return {
    title: options.title ?? "ENA Plot",
    dimensions,
    axes: {
      x: { title: dimensions[0], range: axes.x },
      y: { title: dimensions[1], range: axes.y }
    },
    palette: options.palette ?? defaultPalette,
    traces: []
  };
}
function addPoints(model, set, selector, options = {}) {
  model.traces.push({
    type: "points",
    name: options.name ?? "Points",
    color: nextColor(model, options.color),
    points: pointsFromRows(set.points.filter((row) => matchesSelector(row, selector)), model.dimensions)
  });
  return model;
}
function addGroup(model, set, selector, options = {}) {
  const points = pointsFromRows(set.points.filter((row) => matchesSelector(row, selector)), model.dimensions);
  const mean = points.length === 0 ? [] : [{
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    label: options.name ?? "Mean"
  }];
  model.traces.push({ type: "group", name: options.name ?? "Mean", color: nextColor(model, options.color), points: mean });
  return model;
}
function addNetwork(model, set, rowOrNetwork, options = {}) {
  const network = isNetworkGraph(rowOrNetwork) ? rowOrNetwork : networkFromConnectionRow(rowOrNetwork ?? set.lineWeights[0] ?? {}, set.codes, set.adjacencyKey, options.minWeight ?? 0);
  model.traces.push({ type: "network", name: options.name ?? "Network", color: nextColor(model, options.color), network: networkWithNodePositions(network, set, model.dimensions) });
  return model;
}
function addNodes(model, set, options = {}) {
  model.traces.push({
    type: "nodes",
    name: options.name ?? "Nodes",
    color: nextColor(model, options.color),
    points: pointsFromRows(set.rotation.nodes ?? [], model.dimensions)
  });
  return model;
}
function addTrajectory(model, set, selector, options = {}) {
  model.traces.push({
    type: "trajectory",
    name: options.name ?? "Trajectory",
    color: nextColor(model, options.color),
    points: pointsFromRows(set.points.filter((row) => matchesSelector(row, selector)), model.dimensions)
  });
  return model;
}
function scalePlot(model, scaleTo) {
  if (typeof scaleTo === "number") {
    model.axes.x.range = [-scaleTo, scaleTo];
    model.axes.y.range = [-scaleTo, scaleTo];
  } else {
    if (scaleTo.x) model.axes.x.range = scaleTo.x;
    if (scaleTo.y) model.axes.y.range = scaleTo.y;
  }
  return model;
}
function toPlotly(model) {
  const data = model.traces.flatMap((trace) => {
    if (trace.network) {
      return trace.network.edges.map((edge) => ({
        type: "scatter",
        mode: "lines",
        name: `${trace.name}: ${edge.name}`,
        line: { color: trace.color, width: Math.max(1, Math.abs(edge.weight) * 4) },
        x: [trace.network?.nodes.find((node) => node.id === edge.source)?.x ?? 0, trace.network?.nodes.find((node) => node.id === edge.target)?.x ?? 0],
        y: [trace.network?.nodes.find((node) => node.id === edge.source)?.y ?? 0, trace.network?.nodes.find((node) => node.id === edge.target)?.y ?? 0]
      }));
    }
    return [{
      type: "scatter",
      mode: trace.type === "trajectory" ? "lines+markers" : "markers",
      name: trace.name,
      marker: { color: trace.color },
      line: { color: trace.color },
      x: (trace.points ?? []).map((point) => point.x),
      y: (trace.points ?? []).map((point) => point.y),
      text: (trace.points ?? []).map((point) => point.label)
    }];
  });
  return {
    data,
    layout: {
      title: model.title,
      xaxis: { title: model.axes.x.title, range: model.axes.x.range },
      yaxis: { title: model.axes.y.title, range: model.axes.y.range }
    }
  };
}

// src/plot/render.ts
var svgNamespace = "http://www.w3.org/2000/svg";
function svgElement(tagName) {
  return document.createElementNS(svgNamespace, tagName);
}
function setAttributes(element, attributes) {
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
}
function scale(value, range, pixels) {
  const span = range[1] - range[0];
  if (Math.abs(span) < 1e-12) return (pixels[0] + pixels[1]) / 2;
  return pixels[0] + (value - range[0]) / span * (pixels[1] - pixels[0]);
}
function pointToPixels(model, point, width, height, margin) {
  return [
    scale(point.x, model.axes.x.range, [margin, width - margin]),
    scale(point.y, model.axes.y.range, [height - margin, margin])
  ];
}
function appendText(group, text, x, y, attributes = {}) {
  const node = svgElement("text");
  node.textContent = text;
  setAttributes(node, { x, y, ...attributes });
  group.append(node);
}
function renderAxes(group, model, width, height, margin) {
  const axis = svgElement("path");
  const x0 = scale(0, model.axes.x.range, [margin, width - margin]);
  const y0 = scale(0, model.axes.y.range, [height - margin, margin]);
  setAttributes(axis, {
    d: `M ${margin} ${y0} L ${width - margin} ${y0} M ${x0} ${margin} L ${x0} ${height - margin}`,
    stroke: "#b5bcc8",
    "stroke-width": 1,
    fill: "none"
  });
  group.append(axis);
  appendText(group, model.axes.x.title, width - margin, height - 10, { "text-anchor": "end", fill: "#475569", "font-size": 12 });
  appendText(group, model.axes.y.title, margin, 18, { fill: "#475569", "font-size": 12 });
}
function renderPointTrace(group, model, trace, width, height, margin, showLabels) {
  const points = trace.points ?? [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    const [x, y] = pointToPixels(model, point, width, height, margin);
    if (trace.type === "trajectory" && index > 0) {
      const previous = points[index - 1];
      if (previous) {
        const [px, py] = pointToPixels(model, previous, width, height, margin);
        const line = svgElement("line");
        setAttributes(line, { x1: px, y1: py, x2: x, y2: y, stroke: trace.color, "stroke-width": 1.5, opacity: 0.8 });
        group.append(line);
      }
    }
    const circle = svgElement("circle");
    const radius = trace.type === "group" ? 6 : trace.type === "nodes" ? 5 : 4;
    setAttributes(circle, { cx: x, cy: y, r: radius, fill: trace.color, stroke: "#ffffff", "stroke-width": 1.25 });
    group.append(circle);
    if (showLabels && point.label) appendText(group, point.label, x + 6, y - 6, { fill: "#334155", "font-size": 11 });
  }
}
function renderNetworkTrace(group, model, trace, width, height, margin, showLabels) {
  const network = trace.network;
  if (!network) return;
  const nodes = new Map(network.nodes.map((node) => [node.id, node]));
  for (const edge of network.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target || source.x === void 0 || source.y === void 0 || target.x === void 0 || target.y === void 0) continue;
    const [x1, y1] = pointToPixels(model, { x: source.x, y: source.y }, width, height, margin);
    const [x2, y2] = pointToPixels(model, { x: target.x, y: target.y }, width, height, margin);
    const line = svgElement("line");
    setAttributes(line, {
      x1,
      y1,
      x2,
      y2,
      stroke: trace.color,
      "stroke-width": Math.max(1, Math.abs(edge.weight) * 4),
      opacity: 0.72,
      "stroke-linecap": "round"
    });
    group.append(line);
  }
  for (const node of network.nodes) {
    if (node.x === void 0 || node.y === void 0) continue;
    const [x, y] = pointToPixels(model, { x: node.x, y: node.y }, width, height, margin);
    const circle = svgElement("circle");
    setAttributes(circle, { cx: x, cy: y, r: 5, fill: "#ffffff", stroke: trace.color, "stroke-width": 2 });
    group.append(circle);
    if (showLabels) appendText(group, node.label, x + 7, y - 7, { fill: "#0f172a", "font-size": 11, "font-weight": 600 });
  }
}
function draw(svg, model, options) {
  const width = options.width;
  const height = options.height;
  const margin = 44;
  svg.replaceChildren();
  setAttributes(svg, { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": model.title });
  const background = svgElement("rect");
  setAttributes(background, { width, height, fill: options.background });
  svg.append(background);
  const root = svgElement("g");
  svg.append(root);
  renderAxes(root, model, width, height, margin);
  for (const trace of model.traces.filter((entry) => entry.type === "network")) {
    renderNetworkTrace(root, model, trace, width, height, margin, options.showLabels);
  }
  for (const trace of model.traces.filter((entry) => entry.type !== "network")) {
    renderPointTrace(root, model, trace, width, height, margin, options.showLabels);
  }
  appendText(root, model.title, margin, height - 12, { fill: "#0f172a", "font-size": 13, "font-weight": 700 });
}
function renderENAPlot(container, model, rendererOptions = {}) {
  const options = {
    width: rendererOptions.width ?? 720,
    height: rendererOptions.height ?? 520,
    clear: rendererOptions.clear ?? true,
    background: rendererOptions.background ?? "#ffffff",
    showLabels: rendererOptions.showLabels ?? true
  };
  if (options.clear) container.replaceChildren();
  const svg = svgElement("svg");
  container.append(svg);
  draw(svg, model, options);
  return {
    element: svg,
    update(nextModel) {
      draw(svg, nextModel, options);
    },
    destroy() {
      svg.remove();
    }
  };
}

export {
  networkFromConnectionRow,
  createENAPlotModel,
  addPoints,
  addGroup,
  addNetwork,
  addNodes,
  addTrajectory,
  scalePlot,
  toPlotly,
  renderENAPlot
};
//# sourceMappingURL=chunk-UJIUOQOU.js.map