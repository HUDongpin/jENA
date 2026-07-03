# R Golden Fixtures

These fixtures are generated from the installed `rENA` R package and are used to
test jENA parity inside the vendored library package.

Regenerate with:

```bash
npm run goldens:r
```

The generated JSON is committed so library tests can run without R in ordinary
JavaScript development environments.
