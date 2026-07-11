import { defineConfig } from "vitest/config";

// Real-browser harness (advisory F-014): runs the worker round-trip and the
// SVG renderer in actual Chromium via Playwright.
export default defineConfig({
  test: {
    include: ["tests/browser/**/*.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: "playwright",
      instances: [{ browser: "chromium" }]
    }
  }
});
