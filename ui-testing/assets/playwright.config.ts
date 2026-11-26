import { defineConfig } from "@playwright/test";

/**
 * UI test suite config (template from the ui-testing skill).
 *
 * EDIT the three marked values:
 *  1. PORT
 *  2. webServer.command — start the app in its DETERMINISTIC mode: pinned date,
 *     fixed data, offline/fake providers for anything that costs money.
 *  3. APP_SCRIPT_MATCH — regex for which script URLs count toward JS coverage
 *     (e.g. "/static/" for a built bundle, "/src/" for a Vite dev server).
 */
const PORT = Number(process.env.E2E_PORT ?? 8790); // 1. EDIT

process.env.APP_SCRIPT_MATCH ??= "/static/"; // 3. EDIT

// The crawler is its own project and only exists when the gate asks for it,
// so `npx playwright test` never runs it by accident.
const inventory = process.env.UI_INVENTORY
  ? [{ name: "inventory", testMatch: /inventory\.crawl\.ts/, use: { viewport: { width: 1440, height: 900 } } }]
  : [];

export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.(spec|crawl)\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // a retry hides flakiness; fix the cause instead
  // .results.json is read by tools/ui-coverage.mjs to check that every
  // state-matrix cell names a test that exists AND passed.
  reporter: [["list"], ["html", { open: "never" }], ["json", { outputFile: ".results.json" }]],
  expect: {
    // 0.2% of pixels: absorbs sub-pixel anti-aliasing noise, still fails on a
    // changed colour, border or spacing anywhere visible.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome", // installed Google Chrome; no browser download
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: process.env.UI_INVENTORY ? inventory : [
    { name: "desktop", testIgnore: /inventory\.crawl\.ts/, use: { viewport: { width: 1440, height: 900 } } },
    {
      // Small screens run only specs tagged @responsive (layout, visual, a11y, edge).
      name: "mobile",
      grep: /@responsive/,
      testIgnore: /inventory\.crawl\.ts/,
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: `node -e "console.error('EDIT webServer.command in playwright.config.ts'); process.exit(1)"`, // 2. EDIT
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false, // a fresh server per run keeps state deterministic
    stdout: "ignore",
    stderr: "pipe",
    timeout: 30_000,
  },
});
