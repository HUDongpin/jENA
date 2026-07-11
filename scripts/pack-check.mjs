// Asserts the npm tarball contains only allowlisted files and every declared
// entry point, so a publish can never ship dev files or miss dist (F-009).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
// --ignore-scripts keeps the prepare build's output out of the JSON stream on
// current npm; older npm versions run prepare anyway, so also skip anything
// printed before the top-level JSON array. Callers (CI, prepublishOnly) run
// the real build before this check.
const raw = execSync("npm pack --dry-run --json --ignore-scripts", { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const jsonStart = raw.startsWith("[") ? 0 : raw.indexOf("\n[") + 1;
if (jsonStart < 0 || raw.indexOf("[", jsonStart) === -1) {
  console.error("npm pack --dry-run --json produced no JSON output");
  process.exit(1);
}
const report = JSON.parse(raw.slice(jsonStart));
const files = report[0].files.map((file) => file.path);

const allowed = [
  /^dist\//,
  /^README\.md$/,
  /^LICENSE$/,
  /^CHANGELOG\.md$/,
  /^PROVENANCE\.md$/,
  /^NUMERICS\.md$/,
  /^package\.json$/
];

const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/core/index.js",
  "dist/rotation/index.js",
  "dist/experimental.js",
  "dist/plot/index.js",
  "dist/browser/index.js",
  "dist/browser/worker.js",
  "README.md",
  "LICENSE",
  "PROVENANCE.md"
];

const stray = files.filter((file) => !allowed.some((pattern) => pattern.test(file)));
const missing = required.filter((file) => !files.includes(file));

const sizeMb = report[0].unpackedSize / 1024 / 1024;
console.log(`tarball: ${files.length} files, ${(report[0].size / 1024).toFixed(1)} kB packed, ${(report[0].unpackedSize / 1024).toFixed(1)} kB unpacked`);

if (stray.length > 0) {
  console.error("Files outside the allowlist would be published:");
  for (const file of stray) console.error(`  ${file}`);
  process.exit(1);
}
if (missing.length > 0) {
  console.error("Required entry points missing from the tarball (run npm run build):");
  for (const file of missing) console.error(`  ${file}`);
  process.exit(1);
}
if (sizeMb > 1) {
  console.error(`Unpacked size ${sizeMb.toFixed(2)} MB exceeds the 1 MB budget.`);
  process.exit(1);
}

// The worker entry registers its message host as a module side effect; if
// sideEffects stops declaring it, bundlers tree-shake a bare
// `import "jena-js/browser/worker"` into an empty worker chunk (0.6.2).
const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
if (!Array.isArray(pkg.sideEffects) || !pkg.sideEffects.includes("./dist/browser/worker.js")) {
  console.error('package.json sideEffects must be an array declaring "./dist/browser/worker.js".');
  process.exit(1);
}

console.log("pack-check OK: only dist + docs ship, all entry points present, worker side effect declared.");
