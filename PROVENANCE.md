# Provenance and Runtime Notes

`jena-js` is the local jENA package used by SENA as a JavaScript-based ENA runtime.

## Source History

- The project descends from the local `rena-js-template.zip` jENA template created for a browser and Node port of rENA.
- The current `vendor/jena-js` source tree is not a direct extraction of that zip. It was reconstructed from the current vendored package build sourcemaps, then completed with package entrypoints, tests, scripts, and R-derived fixtures.
- Some low-level core files are byte-identical to the template; higher-level runtime modules such as rotations, plotting, browser client, streaming/performance helpers, and stats reflect the later vendored package state.

## Relationship to rENA

- rENA is the reference implementation for ENA behavior.
- This package ports ENA accumulation, rotation, projection, and node-position behavior to TypeScript/JavaScript.
- R-derived JSON fixtures are generated from rENA and used for parity tests.

## Runtime Boundary

The package runtime is pure JavaScript:

- no R runtime is required;
- no Rserve or OpenCPU service is required;
- no server runtime is required for browser use;
- no React or Next.js dependency is required by the package.

R is used only for development-time tasks:

- regenerating golden fixtures with `npm run goldens:r`;
- comparing JavaScript behavior to rENA outputs in tests.

## License

The package is distributed under GPL-3.0-only. The rENA reference source is GPL-compatible, and this JavaScript port preserves that licensing posture.
