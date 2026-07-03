# jENA

`jena-js` is a standalone TypeScript and JavaScript implementation of Epistemic Network Analysis (ENA) for browser and Node runtimes. It is used by SENA as a JavaScript-based ENA engine in place of a live rENA/R runtime.

The runtime is pure JavaScript. It does not require R, Rserve, OpenCPU, Next.js, React, or a server process to run ENA models. R is used only for development-time golden fixture generation and parity testing against rENA.

## Install

From a packed tarball:

```bash
npm install ./jena-js-0.1.1.tgz
```

From this repository workspace:

```bash
npm install ./vendor/jena-js
```

## Usage

```ts
import { ena } from "jena-js";

const set = ena({
  rows: [
    { unit: "u1", conv: "c1", A: 1, B: 0, C: 0 },
    { unit: "u1", conv: "c1", A: 0, B: 1, C: 0 },
    { unit: "u2", conv: "c1", A: 1, B: 1, C: 0 }
  ],
  units: ["unit"],
  conversation: ["conv"],
  codes: ["A", "B", "C"],
  model: "EndPoint",
  window: "MovingStanzaWindow",
  weightBy: "binary",
  windowSizeBack: 2,
  dimensions: 2
});

console.log(set.connectionCounts);
console.log(set.lineWeights);
console.log(set.points);
console.log(set.rotation.nodes);
```

## Entrypoints

```ts
import { ena, accumulateData, makeSet } from "jena-js";
import { rowsToCoOccurrences, refWindowMatrix } from "jena-js/core";
import { createENAPlotModel, toPlotly } from "jena-js/plot";
import { createENAWorkerClient } from "jena-js/browser";
```

The web worker entrypoint is exported as:

```ts
import "jena-js/browser/worker";
```

## Supported Runtime Surface

The package currently includes:

- endpoint, accumulated trajectory, and separate trajectory ENA models;
- moving stanza and conversation windows;
- binary and sum weighting;
- SVD, mean, generalized, regression, HENA-style, and spherical rotation helpers;
- undirected and directed node-position helpers;
- lightweight plot model adapters and SVG rendering helpers;
- browser worker client utilities;
- development-time R-derived golden fixtures for parity checks.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Generate R-derived golden fixtures when R and rENA are available:

```bash
npm run goldens:r
```

Then run the JavaScript parity tests:

```bash
npm test
```

R is not part of the package runtime path. The generated JSON fixtures are committed so ordinary JavaScript testing does not require R.

## Provenance

See [PROVENANCE.md](./PROVENANCE.md) for source history, rENA relationship, and runtime notes.

## License

GPL-3.0-only. This package is a JavaScript port derived from and validated against GPL-compatible rENA behavior, and preserves that licensing posture.
