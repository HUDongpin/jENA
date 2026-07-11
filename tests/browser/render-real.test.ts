import { describe, expect, it } from "vitest";
import { ena } from "../../src/index.js";
import type { Row } from "../../src/index.js";
import { addNetwork, addNodes, addPoints, createENAPlotModel } from "../../src/plot/model.js";
import { renderENAPlot } from "../../src/plot/render.js";

// Real-DOM smoke test for the SVG renderer (advisory F-014).

const rows: Row[] = [
  { unit: "u1", conv: "c1", A: 1, B: 0, C: 1 },
  { unit: "u1", conv: "c1", A: 0, B: 1, C: 0 },
  { unit: "u2", conv: "c1", A: 1, B: 1, C: 0 },
  { unit: "u3", conv: "c1", A: 1, B: 0, C: 1 }
];

describe("renderENAPlot in a real browser", () => {
  it("renders points, nodes, and network edges into an SVG", () => {
    const set = ena({ rows, units: ["unit"], conversation: ["conv"], codes: ["A", "B", "C"], windowSizeBack: 2 });
    let model = createENAPlotModel(set, { title: "Browser smoke" });
    model = addPoints(model, set);
    model = addNodes(model, set);
    model = addNetwork(model, set);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const renderer = renderENAPlot(container, model);

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("role")).toBe("img");
    // 3 unit points + 3 code nodes (as circles) plus network node circles.
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(6);
    const texts = [...container.querySelectorAll("text")].map((node) => node.textContent);
    expect(texts).toContain("Browser smoke");

    // update() re-draws idempotently; destroy() removes the SVG.
    renderer.update(model);
    expect(container.querySelectorAll("svg").length).toBe(1);
    renderer.destroy();
    expect(container.querySelector("svg")).toBeNull();
    container.remove();
  });
});
