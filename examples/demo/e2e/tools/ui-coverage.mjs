#!/usr/bin/env node
// ui-coverage.mjs — answer "did the tests touch every piece of UI?" with a list,
// not a feeling.
//
//  1. UI element coverage. Denominator = every interactive element the crawler
//     found (.ui-inventory.json) ∪ every one any test saw on screen
//     (.ui-coverage/*.json, which catches error/empty/busy-only controls).
//     Numerator = elements some test actually clicked, typed into, changed or
//     activated by key. Focus alone (a Tab walk) does not count.
//  2. State-matrix check. Every cell of state-matrix.md must name tests that
//     exist and PASSED in the last run (.results.json), or say "n/a: <reason>".
//
// Usage (from the e2e/ directory):
//   node tools/ui-coverage.mjs [--min=100] [--no-matrix] [--json]
//   node tools/ui-coverage.mjs --draft-matrix   # write state-matrix.draft.md from the inventory
//
// Exit codes: 0 ok, 1 below min / matrix problems / config errors, 2 no data.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };
const short = (key) => key.split(" | ").slice(1).join(" | ");

function loadConfig(root) {
  const cfg = readJson(path.join(root, "ui-coverage.json"), {});
  const errors = [];
  const ignore = (cfg.ignore ?? []).map((r, i) => {
    if (!r || typeof r.match !== "string" || !r.match) { errors.push(`ignore[${i}]: needs "match"`); return null; }
    if (typeof r.reason !== "string" || r.reason.trim().length < 8) errors.push(`ignore[${i}] "${r.match}": needs a real "reason" (why no test can or should touch it)`);
    const m = /^\/(.*)\/([a-z]*)$/.exec(r.match);
    return { ...r, test: m ? ((re) => (k) => re.test(k))(new RegExp(m[1], m[2])) : (k) => k.includes(r.match), used: 0 };
  }).filter(Boolean);
  return { cfg, ignore, errors };
}

export function collect(root = ".") {
  const inv = readJson(path.join(root, ".ui-inventory.json"), null);
  const dir = path.join(root, ".ui-coverage");
  const runs = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(dir, f), null)).filter(Boolean) : [];
  const all = new Map(); // key -> { rec, enabled, sources:Set, hitBy:Set }
  const add = (rec, source) => {
    let e = all.get(rec.key);
    if (!e) all.set(rec.key, (e = { rec, enabled: false, sources: new Set(), hitBy: new Set() }));
    e.enabled ||= !rec.disabled;
    e.sources.add(source);
    return e;
  };
  for (const r of inv?.elements ?? []) add(r, r.foundBy ? `crawl (${r.foundBy})` : "crawl");
  for (const run of runs) {
    for (const r of run.seen ?? []) add(r, `seen in ${run.test}`);
    for (const r of run.hits ?? []) { const e = add(r, `seen in ${run.test}`); e.enabled = true; e.hitBy.add(run.test); }
  }
  return { inv, runs, all };
}

// ---------- state matrix ----------
// "@responsive"-style tags are routing, not identity: refs may leave them out.
const normTitle = (t) => t.replace(/(^|\s)@[\w-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
function testIndex(results) {
  const tests = [];
  const walk = (suite, titles, file) => {
    const f = suite.file || file;
    for (const spec of suite.specs ?? []) {
      const statuses = (spec.tests ?? []).map((t) => t.status);
      const status = statuses.includes("unexpected") ? "failed" : statuses.includes("flaky") ? "flaky"
        : statuses.includes("expected") ? "passed" : "skipped";
      tests.push({ file: f, stem: path.basename(f ?? "").replace(/\.(spec|test)\.[cm]?[jt]sx?$/, "").toLowerCase(),
        titles: [...titles, spec.title].map(normTitle), status });
    }
    for (const s of suite.suites ?? []) walk(s, [...titles, s.title], f);
  };
  for (const s of results?.suites ?? []) walk(s, [], s.file);
  return tests;
}

function parseTables(md) {
  const rows = [];
  let header = null, section = "";
  for (const [i, raw] of md.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line.startsWith("#")) { section = line.replace(/^#+\s*/, ""); header = null; continue; }
    if (!line.startsWith("|")) { header = null; continue; }
    const cells = line.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
    if (!header) { header = cells; continue; }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
    rows.push({ line: i + 1, section, header, cells });
  }
  return rows;
}

export function checkMatrix(root = ".") {
  const problems = [];
  const mdPath = path.join(root, "state-matrix.md");
  if (!fs.existsSync(mdPath)) return { problems: ["state-matrix.md not found (copy it from the skill and fill it in)"], cells: 0 };
  const results = readJson(path.join(root, ".results.json"), null);
  if (!results) return { problems: [".results.json not found: run the suite first (the json reporter writes it)"], cells: 0 };
  const tests = testIndex(results);
  let cells = 0;
  for (const row of parseTables(fs.readFileSync(mdPath, "utf8"))) {
    const label = row.cells[0];
    if (/^_?e\.g\./i.test(label) || row.cells.every((c) => !c)) continue; // template examples / blank rows
    row.cells.slice(1).forEach((cell, ci) => {
      const where = `state-matrix.md:${row.line} ${row.section} › ${label.replace(/[_*`]/g, "")} › ${row.header[ci + 1] ?? `col ${ci + 2}`}`;
      cells++;
      if (!cell) return problems.push(`${where}: empty cell (a gap)`);
      if (/^n\/?a\b/i.test(cell)) {
        if (!/^n\/?a\s*[:—-]\s*\S.{4,}/i.test(cell)) problems.push(`${where}: "n/a" needs a reason ("n/a: …")`);
        return;
      }
      for (const ref of cell.split(";").map((s) => s.replace(/`/g, "").trim()).filter(Boolean)) {
        const parts = ref.split(/\s+(?:›|>)\s+/).map(normTitle);
        if (parts.length < 2) { problems.push(`${where}: "${ref}" is not "spec › test title"`); continue; }
        const [stem, ...title] = parts;
        const hits = tests.filter((t) => t.stem === stem && title.every((p, k) => t.titles[t.titles.length - title.length + k] === p));
        if (!hits.length) problems.push(`${where}: no test "${ref}"`);
        else if (!hits.some((t) => t.status === "passed")) problems.push(`${where}: "${ref}" did not pass (${hits.map((t) => t.status).join(", ")})`);
      }
    });
  }
  return { problems, cells };
}

// ---------- report ----------
export function analyze({ root = ".", min = null, matrix = true } = {}) {
  const { cfg, ignore, errors } = loadConfig(root);
  if (min == null) min = cfg.thresholds?.ui ?? 100;
  const { inv, runs, all } = collect(root);
  if (!inv && !runs.length) return { status: 2, text: "❌ No UI data: run the crawler and the suite first (node tools/ui-gate.mjs does both)." };

  const ignored = [], disabledOnly = [], counted = [];
  for (const e of all.values()) {
    const rule = ignore.find((r) => r.test(e.rec.key));
    if (rule) { rule.used++; ignored.push({ e, rule }); continue; }
    if (!e.enabled) { disabledOnly.push(e); continue; }
    counted.push(e);
  }
  const covered = counted.filter((e) => e.hitBy.size);
  const pct = counted.length ? (covered.length / counted.length) * 100 : 100;
  const out = [];
  out.push(`UI coverage: ${inv ? `inventory of ${inv.elements.length} elements on ${inv.routes.length} routes` : "⚠️  no .ui-inventory.json (crawler not run) — denominator is only what tests saw"}, ${runs.length} test runs`);

  const byRoute = new Map();
  for (const e of counted) {
    const r = byRoute.get(e.rec.route) ?? { total: 0, hit: 0, missing: [] };
    r.total++; if (e.hitBy.size) r.hit++; else r.missing.push(e);
    byRoute.set(e.rec.route, r);
  }
  for (const [route, r] of [...byRoute].sort()) {
    out.push(`\n${r.missing.length ? "•" : "✅"} ${route}  ${r.hit}/${r.total} (${((r.hit / r.total) * 100).toFixed(1)}%)`);
    for (const e of r.missing.sort((a, b) => a.rec.key.localeCompare(b.rec.key))) {
      out.push(`     never interacted: ${short(e.rec.key)}`);
      out.push(`       found: ${[...e.sources][0]}${e.sources.size > 1 ? ` (+${e.sources.size - 1} more)` : ""}`);
    }
  }
  if (disabledOnly.length) {
    out.push(`\nℹ️  only ever seen disabled (${disabledOnly.length}) — a state cell should show when they enable, or ignore them with a reason:`);
    for (const e of disabledOnly) out.push(`     ${e.rec.key}`);
  }
  const smells = [...all.values()].filter((e) => e.rec.semantic === false);
  if (smells.length) {
    out.push(`\n⚠️  clickable without a role (${smells.length}) — keyboard and screen-reader users can't use these; prefer <button>/<a>:`);
    for (const e of smells) out.push(`     ${e.rec.key}`);
  }
  // Same route + region + role, many different names: probably rows rendered from data.
  const groups = new Map();
  for (const e of all.values()) {
    if (e.rec.collection) continue;
    const g = `${e.rec.route} | ${e.rec.region} | ${e.rec.role}`;
    groups.set(g, (groups.get(g) ?? 0) + 1);
  }
  const lists = [...groups].filter(([, n]) => n >= 5);
  if (lists.length) {
    out.push(`\n💡 possible data-driven lists (add the row selector to "collections" in ui-coverage.json if each row is the same control):`);
    for (const [g, n] of lists) out.push(`     ${n}× ${g}`);
  }
  for (const r of ignore.filter((r) => !r.used)) out.push(`\n⚠️  ignore rule "${r.match}" matched nothing — remove it`);
  if (ignored.length) out.push(`\nignored (${ignored.length}): ${[...new Set(ignored.map((i) => i.rule.match))].join(", ")}`);

  let matrixResult = { problems: [], cells: 0 };
  if (matrix) {
    matrixResult = checkMatrix(root);
    out.push(`\nState matrix: ${matrixResult.cells} cells, ${matrixResult.problems.length} problems`);
    for (const p of matrixResult.problems) out.push(`     ${p}`);
  }
  for (const e of errors) out.push(`❌ ui-coverage.json ${e}`);

  const ok = pct >= min && !matrixResult.problems.length && !errors.length;
  out.push(`\n${pct >= min ? "✅" : "❌"} UI elements interacted: ${covered.length}/${counted.length} (${pct.toFixed(1)}%), min ${min}%`);
  return {
    status: ok ? 0 : 1, pct, total: counted.length, covered: covered.length,
    uncovered: counted.filter((e) => !e.hitBy.size).map((e) => e.rec.key),
    disabledOnly: disabledOnly.length, smells: smells.length, matrixProblems: matrixResult.problems,
    matrixCells: matrixResult.cells, configErrors: errors, text: out.join("\n"),
  };
}

export function draftMatrix(root = ".") {
  const { all } = collect(root);
  if (!all.size) return null;
  const rows = [...all.values()].map((e) => e.rec).sort((a, b) => a.key.localeCompare(b.key));
  const md = [
    "# State matrix draft (generated — merge into state-matrix.md)", "",
    "One row per control the crawler or the tests found. Delete rows you merge into a region row; never delete a row just to make the gate pass.", "",
    "## Controls", "",
    "| Control | Effect + request | Hover | Pressed | Focus-visible | Disabled | Busy | Failure |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${short(r.key).replace(/\|/g, "·")} \`${r.route}\` | | | | | | | |`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "state-matrix.draft.md"), md);
  return rows.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--draft-matrix")) {
    const n = draftMatrix();
    console.log(n == null ? "❌ No inventory or test data yet." : `✅ state-matrix.draft.md: ${n} control rows`);
    process.exit(n == null ? 2 : 0);
  }
  const minArg = process.argv.find((a) => a.startsWith("--min="));
  const r = analyze({ min: minArg ? Number(minArg.slice(6)) : null, matrix: !process.argv.includes("--no-matrix") });
  if (process.argv.includes("--json")) console.log(JSON.stringify({ ...r, text: undefined }, null, 2));
  else (r.status === 2 ? console.error : console.log)(r.text);
  process.exit(r.status);
}
