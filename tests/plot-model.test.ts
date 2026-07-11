import { describe, expect, it } from "vitest";
import { ena } from "../src/index.js";
import type { ENASet, Row } from "../src/index.js";
import {
  addGroup,
  addNetwork,
  addNodes,
  addPoints,
  addTrajectory,
  createENAPlotModel,
  scalePlot,
  toPlotly
} from "../src/plot/model.js";
import { networkFromConnectionRow } from "../src/plot/network.js";
import type { NetworkGraph } from "../src/plot/network.js";

// The plot model + plotly adapter are jena-specific conveniences (rENA's
// plotting stack is R-plotly and structurally incomparable), so these are
// contract tests: every builder and the toPlotly mapping is pinned against a
// deterministic ENA set.

const rows: Row[] = [
  { unit: "u1", conv: "c1", grp: "G1", A: 1, B: 0, C: 1 },
  { unit: "u1", conv: "c1", grp: "G1", A: 0, B: 1, C: 0 },
  { unit: "u2", conv: "c1", grp: "G1", A: 1, B: 1, C: 0 },
  { unit: "u2", conv: "c1", grp: "G1", A: 0, B: 1, C: 1 },
  { unit: "u3", conv: "c1", grp: "G2", A: 1, B: 0, C: 1 },
  { unit: "u3", conv: "c1", grp: "G2", A: 1, B: 1, C: 0 }
];

function makeSet(): ENASet {
  return ena({
    rows,
    units: ["unit"],
    conversation: ["conv"],
    codes: ["A", "B", "C"],
    metadata: ["grp"],
    windowSizeBack: 2
  });
}

const set = makeSet();
const pointX = (index: number) => Number(set.points[index]?.SVD1);
const pointY = (index: number) => Number(set.points[index]?.SVD2);

describe("createENAPlotModel", () => {
  it("defaults dimensions and axis titles to the first two rotation columns", () => {
    const model = createENAPlotModel(set);
    expect(model.dimensions).toEqual(["SVD1", "SVD2"]);
    expect(model.axes.x.title).toBe("SVD1");
    expect(model.axes.y.title).toBe("SVD2");
    expect(model.traces).toEqual([]);
  });

  it("scales axes to the node extent by default (padding 1.2, symmetric, 1e-9 floor)", () => {
    const model = createENAPlotModel(set);
    const nodes = set.rotation.nodes ?? [];
    // Degenerate axes are floored at 1e-9 before padding so ranges never
    // collapse to zero width.
    const extent = (dimension: string) =>
      Math.max(1e-9, ...nodes.map((node) => Math.abs(Number(node[dimension] ?? 0)))) * 1.2;
    expect(model.axes.x.range[0]).toBeCloseTo(-extent("SVD1"), 12);
    expect(model.axes.x.range[1]).toBeCloseTo(extent("SVD1"), 12);
    expect(model.axes.y.range[1]).toBeCloseTo(extent("SVD2"), 12);
  });

  it("supports scaleTo points, fixed numbers, and partial overrides", () => {
    const byPoints = createENAPlotModel(set, { scaleTo: "points", axisPadding: 1.5 });
    const maxPointX = Math.max(...set.points.map((row) => Math.abs(Number(row.SVD1 ?? 0)))) * 1.5;
    expect(byPoints.axes.x.range[1]).toBeCloseTo(maxPointX, 12);

    const fixed = createENAPlotModel(set, { scaleTo: 2 });
    expect(fixed.axes.x.range).toEqual([-2, 2]);
    expect(fixed.axes.y.range).toEqual([-2, 2]);

    const partial = createENAPlotModel(set, { scaleTo: { x: [-9, 9] } });
    expect(partial.axes.x.range).toEqual([-9, 9]);
    // y falls back to the network-based default.
    expect(partial.axes.y.range[1]).toBeGreaterThan(0);
  });
});

describe("trace builders", () => {
  it("addPoints copies point coordinates, labels, and cycles the palette", () => {
    const model = addPoints(addPoints(createENAPlotModel(set), set), set);
    const first = model.traces[0]!;
    const second = model.traces[1]!;
    expect(first.type).toBe("points");
    expect(first.points).toHaveLength(set.points.length);
    expect(first.points?.[0]?.x).toBeCloseTo(pointX(0), 12);
    expect(first.points?.[0]?.y).toBeCloseTo(pointY(0), 12);
    expect(first.points?.map((point) => point.label)).toEqual(["u1", "u2", "u3"]);
    expect(first.color).toBe(model.palette[0]);
    expect(second.color).toBe(model.palette[1]);
  });

  it("addPoints honors object and function selectors and explicit colors", () => {
    const model = createENAPlotModel(set);
    addPoints(model, set, { grp: "G2" }, { name: "Red team", color: "#123456" });
    addPoints(model, set, (row) => String(row.unit) !== "u3");
    expect(model.traces[0]?.name).toBe("Red team");
    expect(model.traces[0]?.color).toBe("#123456");
    expect(model.traces[0]?.points?.map((point) => point.label)).toEqual(["u3"]);
    expect(model.traces[1]?.points?.map((point) => point.label)).toEqual(["u1", "u2"]);
  });

  it("addGroup plots the mean of the selected points", () => {
    const model = addGroup(createENAPlotModel(set), set, { grp: "G1" }, { name: "G1 mean" });
    const selected = set.points.filter((row) => row.grp === "G1");
    const meanX = selected.reduce((sum, row) => sum + Number(row.SVD1 ?? 0), 0) / selected.length;
    const trace = model.traces[0]!;
    expect(trace.type).toBe("group");
    expect(trace.points).toHaveLength(1);
    expect(trace.points?.[0]?.x).toBeCloseTo(meanX, 12);
    expect(trace.points?.[0]?.label).toBe("G1 mean");
  });

  it("addGroup with a selector matching nothing yields an empty trace", () => {
    const model = addGroup(createENAPlotModel(set), set, { grp: "nope" });
    expect(model.traces[0]?.points).toEqual([]);
  });

  it("addNodes plots code node positions with code labels", () => {
    const model = addNodes(createENAPlotModel(set), set);
    const trace = model.traces[0]!;
    expect(trace.points?.map((point) => point.label)).toEqual(["A", "B", "C"]);
    const nodes = set.rotation.nodes ?? [];
    expect(trace.points?.[1]?.x).toBeCloseTo(Number(nodes[1]?.SVD1 ?? Number.NaN), 12);
  });

  it("addTrajectory keeps point order and marks the trace type", () => {
    const model = addTrajectory(createENAPlotModel(set), set);
    expect(model.traces[0]?.type).toBe("trajectory");
    expect(model.traces[0]?.points?.map((point) => point.label)).toEqual(["u1", "u2", "u3"]);
  });
});

describe("networks", () => {
  it("networkFromConnectionRow reads weights by adjacency name and filters strictly above minWeight", () => {
    const row: Row = { "A & B": 0.5, "A & C": 0, "B & C": 0.25 };
    const graph = networkFromConnectionRow(row, set.codes, set.adjacencyKey, 0);
    expect(graph.nodes.map((node) => node.id)).toEqual(["A", "B", "C"]);
    expect(graph.edges.map((edge) => edge.name)).toEqual(["A & B", "B & C"]); // zero-weight edge dropped
    expect(graph.edges[0]?.weight).toBe(0.5);

    const filtered = networkFromConnectionRow(row, set.codes, set.adjacencyKey, 0.25);
    expect(filtered.edges.map((edge) => edge.name)).toEqual(["A & B"]); // strictly greater than minWeight
  });

  it("addNetwork defaults to the first lineWeights row and injects node positions", () => {
    const model = addNetwork(createENAPlotModel(set), set);
    const network = model.traces[0]?.network;
    expect(network).toBeTruthy();
    const expectedWeights = set.adjacencyKey
      .map((edge) => Number(set.lineWeights[0]?.[edge.name] ?? 0))
      .filter((weight) => Math.abs(weight) > 0);
    expect(network?.edges.map((edge) => edge.weight)).toEqual(expectedWeights);
    const nodes = set.rotation.nodes ?? [];
    const nodeA = network?.nodes.find((node) => node.id === "A");
    expect(nodeA?.x).toBeCloseTo(Number(nodes[0]?.SVD1 ?? Number.NaN), 12);
    expect(nodeA?.y).toBeCloseTo(Number(nodes[0]?.SVD2 ?? Number.NaN), 12);
  });

  it("addNetwork accepts an explicit row and a prebuilt graph", () => {
    const explicit = addNetwork(createENAPlotModel(set), set, set.lineWeights[1], { minWeight: 0.4 });
    for (const edge of explicit.traces[0]?.network?.edges ?? []) {
      expect(Math.abs(edge.weight)).toBeGreaterThan(0.4);
    }

    const prebuilt: NetworkGraph = {
      nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }],
      edges: [{ source: "A", target: "B", weight: 0.7, name: "A & B" }]
    };
    const model = addNetwork(createENAPlotModel(set), set, prebuilt);
    // Positions are injected for known code ids even on prebuilt graphs.
    expect(model.traces[0]?.network?.nodes[0]?.x).toBeDefined();
    expect(model.traces[0]?.network?.edges).toEqual(prebuilt.edges);
  });
});

describe("scalePlot", () => {
  it("sets symmetric numeric ranges and partial axis overrides", () => {
    const model = createENAPlotModel(set);
    scalePlot(model, 3);
    expect(model.axes.x.range).toEqual([-3, 3]);
    scalePlot(model, { y: [-1, 5] });
    expect(model.axes.x.range).toEqual([-3, 3]);
    expect(model.axes.y.range).toEqual([-1, 5]);
  });
});

describe("toPlotly", () => {
  it("maps point traces to scatter markers with coordinates, labels, and colors", () => {
    const model = addTrajectory(addPoints(createENAPlotModel(set, { title: "Adapter test" }), set), set);
    const { data, layout } = toPlotly(model);
    expect(data).toHaveLength(2);
    const points = data[0]!;
    expect(points.type).toBe("scatter");
    expect(points.mode).toBe("markers");
    expect(points.x).toEqual(set.points.map((row) => Number(row.SVD1 ?? 0)));
    expect(points.y).toEqual(set.points.map((row) => Number(row.SVD2 ?? 0)));
    expect(points.text).toEqual(["u1", "u2", "u3"]);
    expect(points.marker?.color).toBe(model.palette[0]);
    expect(data[1]?.mode).toBe("lines+markers"); // trajectory
    expect(layout.title).toBe("Adapter test");
    expect(layout.xaxis).toEqual({ title: "SVD1", range: model.axes.x.range });
    expect(layout.yaxis).toEqual({ title: "SVD2", range: model.axes.y.range });
  });

  it("emits one line trace per network edge with endpoints resolved from node positions", () => {
    const model = addNetwork(createENAPlotModel(set), set, undefined, { name: "Net" });
    const network = model.traces[0]!.network!;
    const { data } = toPlotly(model);
    expect(data).toHaveLength(network.edges.length);
    const nodeById = new Map(network.nodes.map((node) => [node.id, node]));
    data.forEach((trace, index) => {
      const edge = network.edges[index]!;
      expect(trace.mode).toBe("lines");
      expect(trace.name).toBe(`Net: ${edge.name}`);
      expect(trace.line?.width).toBeCloseTo(Math.max(1, Math.abs(edge.weight) * 4), 12);
      expect(trace.x).toEqual([nodeById.get(edge.source)?.x, nodeById.get(edge.target)?.x]);
      expect(trace.y).toEqual([nodeById.get(edge.source)?.y, nodeById.get(edge.target)?.y]);
    });
  });

  it("falls back to origin endpoints for edges naming unknown nodes", () => {
    const model = createENAPlotModel(set);
    const dangling: NetworkGraph = {
      nodes: [{ id: "A", label: "A", x: 0.5, y: -0.25 }],
      edges: [{ source: "A", target: "Ghost", weight: 1, name: "A & Ghost" }]
    };
    model.traces.push({ type: "network", name: "Dangling", color: "#000000", network: dangling });
    const { data } = toPlotly(model);
    expect(data[0]?.x).toEqual([0.5, 0]);
    expect(data[0]?.y).toEqual([-0.25, 0]);
  });
});
