// Compares a freshly regenerated golden fixture against the committed one.
// Usage: node scripts/compare-goldens.mjs [committed.json] [regenerated.json]
// Exits non-zero if any shared value differs beyond 1e-9 relative tolerance,
// so fixture updates are always a deliberate, reviewed step.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const goldensDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "goldens");
const committedPath = process.argv[2] ?? join(goldensDir, "sena-configs.generated.json");
const regeneratedPath = process.argv[3] ?? join(goldensDir, "sena-configs.regenerated.json");

const committed = JSON.parse(readFileSync(committedPath, "utf8"));
const regenerated = JSON.parse(readFileSync(regeneratedPath, "utf8"));

const TOL = 1e-9;
let diffs = 0;
let compared = 0;

function report(message) {
  diffs += 1;
  if (diffs <= 25) console.log(message);
}

function walk(x, y, path) {
  if (typeof x === "number" && typeof y === "number") {
    compared += 1;
    if (Math.abs(x - y) > TOL * Math.max(1, Math.abs(x), Math.abs(y))) {
      report(`DIFF at ${path}: ${x} vs ${y}`);
    }
    return;
  }
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) {
      report(`LENGTH at ${path}: ${x.length} vs ${y.length}`);
      return;
    }
    x.forEach((value, index) => walk(value, y[index], `${path}[${index}]`));
    return;
  }
  if (x && y && typeof x === "object" && typeof y === "object") {
    for (const key of Object.keys(x)) {
      if (key === "meta") continue; // generation metadata is expected to differ
      if (!(key in y)) {
        report(`MISSING KEY in regenerated at ${path}.${key}`);
        continue;
      }
      walk(x[key], y[key], `${path}.${key}`);
    }
    return;
  }
  compared += 1;
  if (String(x) !== String(y)) report(`VALUE at ${path}: ${String(x)} vs ${String(y)}`);
}

walk(committed, regenerated, "$");
console.log(`compared=${compared} scalar values, diffs=${diffs} (tolerance ${TOL})`);
if (diffs > 0) {
  console.log("Fixture values changed — inspect before replacing the committed fixture.");
  process.exit(1);
}
console.log("Regenerated fixture matches the committed goldens.");
