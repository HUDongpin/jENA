// Asserts the npm tarball contains only allowlisted files and every declared
// entry point, so a publish can never ship dev files or miss dist (F-009).
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
// --ignore-scripts keeps the prepare build's output out of the JSON stream;
// callers (CI, prepublishOnly) run the build before this check.
const report = JSON.parse(execSync("npm pack --dry-run --json --ignore-scripts", { cwd: projectDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
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
console.log("pack-check OK: only dist + docs ship, all entry points present.");
