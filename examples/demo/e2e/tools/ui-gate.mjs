#!/usr/bin/env node
// ui-gate.mjs — one command that says whether the UI is tested, and lists what isn't.
//
//   1. lint the specs for hollow tests                     (lint-specs.mjs)
//   2. crawl the UI inventory                              (tests/inventory.crawl.ts)
//   3. run the suite N times; every run must be green      (stability)
//   4. JS function coverage ≥ thresholds.jsFunctions       (coverage-report.mjs)
//   5. UI element coverage ≥ thresholds.ui, and every state-matrix cell
//      names a passing test or a reasoned n/a              (ui-coverage.mjs)
// and writes UI-COVERAGE.md with the same verdict.
//
// Usage (from the e2e/ directory):
//   node tools/ui-gate.mjs                 # full gate, 1 run
//   node tools/ui-gate.mjs --runs=3        # ship gate: 3 consecutive green runs
//   node tools/ui-gate.mjs --skip-crawl    # reuse .ui-inventory.json
//   node tools/ui-gate.mjs --no-run        # only re-check the last run's data
//   node tools/ui-gate.mjs -- --grep @nav  # extra args go to playwright test
// Exit code 0 only when every check passes.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { lint } from "./lint-specs.mjs";
import { analyze as jsCoverage } from "./coverage-report.mjs";
import { analyze as uiCoverage } from "./ui-coverage.mjs";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const own = sep < 0 ? argv : argv.slice(0, sep);
const extra = sep < 0 ? [] : argv.slice(sep + 1);
const opt = (name, def) => { const a = own.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=")[1] : def; };
const flag = (name) => own.includes(`--${name}`);

const cfg = JSON.parse(fs.readFileSync("ui-coverage.json", "utf8"));
const RUNS = Number(opt("runs", 1));
const MIN_UI = Number(opt("min-ui", cfg.thresholds?.ui ?? 100));
const MIN_JS = Number(opt("min-js", cfg.thresholds?.jsFunctions ?? 90));

// Windows needs a shell to find npx/npm; pass one quoted command line (an args
// array with shell:true is deprecated and unescaped).
const quote = (a) => (/^[\w@./:=+-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`);
const sh = (cmd, args, opts) => process.platform === "win32"
  ? spawnSync([cmd, ...args].map(quote).join(" "), { ...opts, shell: true })
  : spawnSync(cmd, args, opts);
const playwright = (args, env = {}) => sh("npx", ["playwright", "test", ...args], {
  stdio: "inherit", env: { ...process.env, ...env },
}).status;
const clean = (...paths) => paths.forEach((p) => fs.rmSync(p, { recursive: true, force: true }));
const rows = [];
const check = (name, ok, detail) => { rows.push({ name, ok, detail }); console.log(`${ok ? "✅" : "❌"} ${name}: ${detail}`); };

console.log("── 1/5 spec lint");
const l = lint({ dir: "tests" });
console.log(l.text);
check("Spec lint", l.status === 0, `${l.errors} errors, ${l.warnings} warnings in ${l.files} files`);

if (!flag("no-run")) {
  if (!flag("skip-crawl")) {
    console.log("\n── 2/5 crawl UI inventory");
    clean(".ui-inventory.json");
    const s = playwright(["--project=inventory", "--reporter=list"], { UI_INVENTORY: "1" });
    check("Inventory crawl", s === 0 && fs.existsSync(".ui-inventory.json"), s === 0 ? "done" : `crawler exited ${s}`);
  }
  console.log(`\n── 3/5 run the suite ×${RUNS}`);
  const statuses = [];
  for (let i = 1; i <= RUNS; i++) {
    clean(".coverage", ".ui-coverage", ".results.json");
    console.log(`\nrun ${i}/${RUNS}`);
    statuses.push(playwright(extra));
  }
  const green = statuses.filter((s) => s === 0).length;
  check(`Suite green ×${RUNS}`, green === RUNS, `${green}/${RUNS} runs green${green && green < RUNS ? " — flaky: fix the cause, don't retry" : ""}`);
}

console.log("\n── 4/5 JS coverage");
const js = jsCoverage({ min: MIN_JS });
console.log(js.text);
check("JS function coverage", js.status === 0, js.status === 2 ? "no data" : `${js.fnPct.toFixed(1)}% (min ${MIN_JS}%)`);

console.log("\n── 5/5 UI coverage + state matrix");
const ui = uiCoverage({ min: MIN_UI });
console.log(ui.text);
check("UI element coverage", ui.status !== 2 && ui.pct >= MIN_UI, ui.status === 2 ? "no data" : `${ui.covered}/${ui.total} interacted, ${ui.pct.toFixed(1)}% (min ${MIN_UI}%)`);
check("State matrix", ui.status !== 2 && !ui.matrixProblems?.length, ui.status === 2 ? "no data" : `${ui.matrixCells} cells, ${ui.matrixProblems.length} problems`);
if (ui.configErrors?.length) check("ui-coverage.json", false, ui.configErrors.join("; "));

const pass = rows.every((r) => r.ok);
const fence = (t) => "```\n" + t.replace(/```/g, "'''") + "\n```";
fs.writeFileSync("UI-COVERAGE.md", [
  `# UI coverage — ${pass ? "PASS" : "FAIL"}`, "",
  `Generated ${new Date().toISOString()} by \`node tools/ui-gate.mjs ${own.join(" ")}\`.`, "",
  "| Check | Result | Detail |", "|---|---|---|",
  ...rows.map((r) => `| ${r.name} | ${r.ok ? "✅" : "❌"} | ${r.detail} |`), "",
  "## Spec lint", "", fence(l.text), "",
  "## UI elements and state matrix", "", fence(ui.text ?? ""), "",
  "## JS coverage", "", fence(js.text ?? ""), "",
].join("\n"));
console.log(`\n${pass ? "✅ UI gate passed" : "❌ UI gate failed"} — details in UI-COVERAGE.md`);
process.exit(pass ? 0 : 1);
