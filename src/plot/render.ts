import type { ENAPlotModel, ENAPlotPoint, ENAPlotTrace } from './model.js';

export interface ENAPlotRendererOptions {
  width?: number;
  height?: number;
  clear?: boolean;
  background?: string;
  showLabels?: boolean;
}

export interface ENAPlotRenderer {
  element: SVGSVGElement;
  update(model: ENAPlotModel): void;
  destroy(): void;
}

const svgNamespace = 'http://www.w3.org/2000/svg';

function svgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS(svgNamespace, tagName);
}

function setAttributes(element: Element, attributes: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
}

function scale(value: number, range: [number, number], pixels: [number, number]): number {
  const span = range[1] - range[0];
  if (Math.abs(span) < 1e-12) return (pixels[0] + pixels[1]) / 2;
  return pixels[0] + ((value - range[0]) / span) * (pixels[1] - pixels[0]);
}

function pointToPixels(model: ENAPlotModel, point: ENAPlotPoint, width: number, height: number, margin: number): [number, number] {
  return [
    scale(point.x, model.axes.x.range, [margin, width - margin]),
    scale(point.y, model.axes.y.range, [height - margin, margin])
  ];
}

function appendText(group: SVGGElement, text: string, x: number, y: number, attributes: Record<string, string | number> = {}): void {
  const node = svgElement('text');
  node.textContent = text;
  setAttributes(node, { x, y, ...attributes });
  group.append(node);
}

function renderAxes(group: SVGGElement, model: ENAPlotModel, width: number, height: number, margin: number): void {
  const axis = svgElement('path');
  const x0 = scale(0, model.axes.x.range, [margin, width - margin]);
  const y0 = scale(0, model.axes.y.range, [height - margin, margin]);
  setAttributes(axis, {
    d: `M ${margin} ${y0} L ${width - margin} ${y0} M ${x0} ${margin} L ${x0} ${height - margin}`,
    stroke: '#b5bcc8',
    'stroke-width': 1,
    fill: 'none'
  });
  group.append(axis);
  appendText(group, model.axes.x.title, width - margin, height - 10, { 'text-anchor': 'end', fill: '#475569', 'font-size': 12 });
  appendText(group, model.axes.y.title, margin, 18, { fill: '#475569', 'font-size': 12 });
}

function renderPointTrace(group: SVGGElement, model: ENAPlotModel, trace: ENAPlotTrace, width: number, height: number, margin: number, showLabels: boolean): void {
  const points = trace.points ?? [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    const [x, y] = pointToPixels(model, point, width, height, margin);
    if (trace.type === 'trajectory' && index > 0) {
      const previous = points[index - 1];
      if (previous) {
        const [px, py] = pointToPixels(model, previous, width, height, margin);
        const line = svgElement('line');
        setAttributes(line, { x1: px, y1: py, x2: x, y2: y, stroke: trace.color, 'stroke-width': 1.5, opacity: 0.8 });
        group.append(line);
      }
    }
    const circle = svgElement('circle');
    const radius = trace.type === 'group' ? 6 : trace.type === 'nodes' ? 5 : 4;
    setAttributes(circle, { cx: x, cy: y, r: radius, fill: trace.color, stroke: '#ffffff', 'stroke-width': 1.25 });
    group.append(circle);
    if (showLabels && point.label) appendText(group, point.label, x + 6, y - 6, { fill: '#334155', 'font-size': 11 });
  }
}

function renderNetworkTrace(group: SVGGElement, model: ENAPlotModel, trace: ENAPlotTrace, width: number, height: number, margin: number, showLabels: boolean): void {
  const network = trace.network;
  if (!network) return;
  const nodes = new Map(network.nodes.map((node) => [node.id, node]));
  for (const edge of network.edges) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target || source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) continue;
    const [x1, y1] = pointToPixels(model, { x: source.x, y: source.y }, width, height, margin);
    const [x2, y2] = pointToPixels(model, { x: target.x, y: target.y }, width, height, margin);
    const line = svgElement('line');
    setAttributes(line, {
      x1,
      y1,
      x2,
      y2,
      stroke: trace.color,
      'stroke-width': Math.max(1, Math.abs(edge.weight) * 4),
      opacity: 0.72,
      'stroke-linecap': 'round'
    });
    group.append(line);
  }
  for (const node of network.nodes) {
    if (node.x === undefined || node.y === undefined) continue;
    const [x, y] = pointToPixels(model, { x: node.x, y: node.y }, width, height, margin);
    const circle = svgElement('circle');
    setAttributes(circle, { cx: x, cy: y, r: 5, fill: '#ffffff', stroke: trace.color, 'stroke-width': 2 });
    group.append(circle);
    if (showLabels) appendText(group, node.label, x + 7, y - 7, { fill: '#0f172a', 'font-size': 11, 'font-weight': 600 });
  }
}

function draw(svg: SVGSVGElement, model: ENAPlotModel, options: Required<ENAPlotRendererOptions>): void {
  const width = options.width;
  const height = options.height;
  const margin = 44;
  svg.replaceChildren();
  setAttributes(svg, { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': model.title });
  const background = svgElement('rect');
  setAttributes(background, { width, height, fill: options.background });
  svg.append(background);

  const root = svgElement('g');
  svg.append(root);
  renderAxes(root, model, width, height, margin);
  for (const trace of model.traces.filter((entry) => entry.type === 'network')) {
    renderNetworkTrace(root, model, trace, width, height, margin, options.showLabels);
  }
  for (const trace of model.traces.filter((entry) => entry.type !== 'network')) {
    renderPointTrace(root, model, trace, width, height, margin, options.showLabels);
  }
  appendText(root, model.title, margin, height - 12, { fill: '#0f172a', 'font-size': 13, 'font-weight': 700 });
}

export function renderENAPlot(container: Element, model: ENAPlotModel, rendererOptions: ENAPlotRendererOptions = {}): ENAPlotRenderer {
  const options: Required<ENAPlotRendererOptions> = {
    width: rendererOptions.width ?? 720,
    height: rendererOptions.height ?? 520,
    clear: rendererOptions.clear ?? true,
    background: rendererOptions.background ?? '#ffffff',
    showLabels: rendererOptions.showLabels ?? true
  };
  if (options.clear) container.replaceChildren();
  const svg = svgElement('svg');
  container.append(svg);
  draw(svg, model, options);
  return {
    element: svg,
    update(nextModel: ENAPlotModel): void {
      draw(svg, nextModel, options);
    },
    destroy(): void {
      svg.remove();
    }
  };
}
