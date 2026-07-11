# Releasing jena-js

Every release ships from `main` with CI green and goes through the
`prepublishOnly` gate — a broken release physically cannot reach the
registry. This checklist was first exercised end-to-end for `0.6.0`
(2026-07-11) and scripted for `0.6.1`.

## 1. Prepare

```bash
git status --porcelain          # clean tree, on main, synced with origin
npm ci                          # clean install from the lockfile
```

- Bump `version` in `package.json` (semver: breaking API → minor while 0.x,
  additions → minor, docs/tooling → patch).
- Add a dated CHANGELOG section describing the release.
- If golden fixtures changed: `npm run goldens:r && npm run goldens:diff`
  (and `goldens:stats` / `goldens:rotations` / `goldens:elasticnet` as
  applicable) — fixture adoption is always its own reviewed commit.

## 2. Verify

```bash
npm run lint && npm run typecheck && npm test
npm run build && npm run pack:check     # tarball = dist + docs only
node scripts/bench.mjs                  # budgets (Apple Silicon baselines)
npm run test:browser                    # real-Chromium worker + SVG tests
npm publish --dry-run                   # eyeball name/version/files/size
```

Commit (`release: vX.Y.Z`), push, and wait for CI (Node 18/20/22 + Chromium)
to go green on the release commit.

## 3. Publish

```bash
npm publish
```

Notes from practice:

- Publishing requires npm's **web 2FA** (security key). The auth link is
  valid for only ~2 minutes, so run `npm publish` from an interactive
  terminal and complete the key prompt immediately. If the gate run eats
  the window, re-run as `npm publish --ignore-scripts` right after a green
  manual gate run — never skip scripts without one.
- `prepublishOnly` re-runs lint + typecheck + tests + build + pack-check;
  `prepare` rebuilds `dist` — a stale build cannot ship.

## 4. Tag and announce

```bash
git tag -a vX.Y.Z -m "jena-js X.Y.Z"
git push origin vX.Y.Z
gh release create vX.Y.Z --title "jena-js X.Y.Z" --notes "<highlights + CHANGELOG pointer>"
```

## 5. Post-release smoke test

The registry's read replicas lag the publish by up to a minute or two — poll
`npm view jena-js version` until it reports the new version before testing.
Then install from the public registry into a scratch directory and run a
small model through the root and at least one subpath:

```bash
mkdir /tmp/consumer && cd /tmp/consumer && npm init -y && npm install jena-js
node --input-type=module -e "import { ena } from 'jena-js'; \
  const s = ena({ rows: [{ unit: 'u1', conv: 'c1', A: 1, B: 1, C: 0 }, \
  { unit: 'u2', conv: 'c1', A: 1, B: 0, C: 1 }], units: ['unit'], \
  conversation: ['conv'], codes: ['A', 'B', 'C'] }); \
  if (Math.abs(Object.values(s.variance).reduce((a, b) => a + b, 0) - 1) > 1e-9) \
  throw new Error('variance'); console.log('ok', s.points.length, 'points');"
```
