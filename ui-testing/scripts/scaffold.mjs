#!/usr/bin/env node
// scaffold.mjs — create a Playwright UI test suite (ui-testing skill layout)
// in <project-dir>/e2e and install its dependencies. Works on Windows, macOS, Linux.
//
// Usage: node scaffold.mjs <project-dir> [--no-install]
//
// Creates:
//   e2e/package.json, playwright.config.ts, ui-coverage.json, state-matrix.md, .gitignore
//   e2e/tests/fixtures.ts, tests/inventory.crawl.ts
//   e2e/tools/ui-probe.js, coverage-report.mjs, ui-coverage.mjs, lint-specs.mjs, ui-gate.mjs
//   e2e/fixtures/
// Requires Node >= 20 and Google Chrome. Never overwrites existing files.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const project = args.find((a) => !a.startsWith("--"));
if (!project) { console.error("Usage: node scaffold.mjs <project-dir> [--no-install]"); process.exit(2); }
if (!fs.existsSync(project)) { console.error(`❌ ${project} does not exist`); process.exit(2); }

// Windows needs a shell to find npx/npm; pass one quoted command line (an args
// array with shell:true is deprecated and unescaped).
const quote = (a) => (/^[\w@./:=+-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
const sh = (cmd, args, opts) => process.platform === "win32"
  ? spawnSync([cmd, ...args].map(quote).join(" "), { ...opts, shell: true })
  : spawnSync(cmd, args, opts);

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const E2E = path.join(path.resolve(project), "e2e");

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) { console.error(`❌ Node ${process.version} is too old: Playwright needs 20+.`); process.exit(1); }
const chrome = {
  win32: [`${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`],
  darwin: ["/Applications/Google Chrome.app"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/opt/google/chrome/chrome"],
}[process.platform] ?? [];
if (!chrome.some((p) => fs.existsSync(p))) {
  console.warn('⚠️  Google Chrome not found: install it, or remove channel: "chrome" from playwright.config.ts and run `npx playwright install chromium`.');
}

for (const d of ["tests", "tools", "fixtures"]) fs.mkdirSync(path.join(E2E, d), { recursive: true });
const copy = (src, dest) => {
  const to = path.join(E2E, dest);
  if (fs.existsSync(to)) return console.log(`⏭  kept existing ${dest}`);
  fs.copyFileSync(path.join(SKILL, src), to);
  console.log(`✅ ${dest}`);
};
copy("assets/playwright.config.ts", "playwright.config.ts");
copy("assets/ui-coverage.json", "ui-coverage.json");
copy("assets/state-matrix.md", "state-matrix.md");
copy("assets/fixtures.ts", "tests/fixtures.ts");
copy("assets/inventory.crawl.ts", "tests/inventory.crawl.ts");
copy("assets/ui-probe.js", "tools/ui-probe.js");
for (const s of ["coverage-report.mjs", "ui-coverage.mjs", "lint-specs.mjs", "ui-gate.mjs"]) copy(`scripts/${s}`, `tools/${s}`);

const write = (dest, body) => {
  const to = path.join(E2E, dest);
  if (fs.existsSync(to)) return console.log(`⏭  kept existing ${dest}`);
  fs.writeFileSync(to, body);
  console.log(`✅ ${dest}`);
};
write("package.json", JSON.stringify({
  name: "e2e", private: true, type: "module",
  scripts: {
    test: "playwright test",
    "test:update": "playwright test --update-snapshots",
    lint: "node tools/lint-specs.mjs",
    coverage: "node tools/coverage-report.mjs && node tools/ui-coverage.mjs",
    "draft-matrix": "node tools/ui-coverage.mjs --draft-matrix",
    gate: "node tools/ui-gate.mjs",
    "gate:ship": "node tools/ui-gate.mjs --runs=3",
    report: "playwright show-report",
  },
}, null, 2) + "\n");
write(".gitignore", ["node_modules/", "test-results/", "playwright-report/", ".coverage/", ".ui-coverage/",
  ".ui-inventory.json", ".results.json", "state-matrix.draft.md", ""].join("\n"));

if (!args.includes("--no-install")) {
  console.log("Installing @playwright/test and @axe-core/playwright…");
  const r = sh("npm", ["install", "-D", "--silent", "@playwright/test", "@axe-core/playwright"], {
    cwd: E2E, stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
  if (r.status !== 0) { console.error("❌ npm install failed (see above). Check registry/network and rerun."); process.exit(1); }
}

console.log(`
Next (in ${E2E}):
  1. playwright.config.ts: PORT, webServer.command (deterministic mode), APP_SCRIPT_MATCH.
  2. tests/fixtures.ts: DEFAULT_SNAPSHOT, READY_SELECTOR, SETTLED.
  3. Capture a snapshot: curl -s http://127.0.0.1:<port>/api/<main> > fixtures/snapshot.json
  4. tests/inventory.crawl.ts: prepare() → the populated-state mocks.
  5. npm run gate  (crawls, runs, reports), then npm run draft-matrix and fill state-matrix.md.
`);
