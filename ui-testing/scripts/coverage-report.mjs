#!/usr/bin/env node
// coverage-report.mjs — merge per-test V8 JS coverage written by fixtures.ts
// into one report per app script: % of functions and % of code executed by
// the whole suite, plus every function and code span no test ever ran.
//
// Usage (from the e2e/ directory):
//   node tools/coverage-report.mjs [--min=90] [--json]
//
// --min=N  exit 1 if total function coverage is below N% (default: ui-coverage.json
//          thresholds.jsFunctions; pass --min=0 to only report).
// Exit codes: 0 ok, 1 below min, 2 no coverage data.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_SPOTS = 40; // keep the listing readable; the count is always printed

// Vite & co. add ?v=hash / ?t=timestamp; the same file must merge into one entry.
const scriptName = (url) => { try { const u = new URL(url); return u.pathname; } catch { return url.split("?")[0]; } };

function codeMask(source) {
  // Count only code characters: skip whitespace and comment-only lines.
  const code = new Uint8Array(source.length);
  let inBlock = false;
  source.split("\n").reduce((off, line) => {
    const t = line.trim();
    const comment = inBlock || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
    if (t.includes("/*") && !t.includes("*/")) inBlock = true;
    else if (t.includes("*/")) inBlock = false;
    if (t && !comment) for (let i = 0; i < line.length; i++) if (!/\s/.test(line[i])) code[off + i] = 1;
    return off + line.length + 1;
  }, 0);
  return code;
}

export function analyze({ dir = path.resolve(".coverage"), min = null } = {}) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  if (!files.length) return { status: 2, text: `❌ No JS coverage in ${dir}. Run the suite first (fixtures.ts writes it).` };

  const scripts = new Map(); // name+length -> { name, source, covered, fns }
  for (const f of files) {
    for (const entry of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))) {
      if (!entry.source) continue;
      const id = `${scriptName(entry.url)}#${entry.source.length}`; // HMR may serve a different version
      let s = scripts.get(id);
      if (!s) scripts.set(id, (s = { name: scriptName(entry.url), source: entry.source, covered: new Uint8Array(entry.source.length), fns: new Map() }));
      // V8 lists ranges outer → inner; applying in order lets nested zero-count
      // blocks override the count of the function that contains them.
      const counts = new Int32Array(entry.source.length).fill(-1);
      for (const fn of entry.functions) {
        for (const r of fn.ranges) counts.fill(r.count, r.startOffset, r.endOffset);
        const top = fn.ranges[0];
        if (!fn.functionName && top.startOffset === 0) continue; // the script body itself
        const key = `${top.startOffset}-${top.endOffset}`;
        const cur = s.fns.get(key) ?? { name: fn.functionName || "(anonymous)", start: top.startOffset, hit: false };
        cur.hit ||= top.count > 0;
        s.fns.set(key, cur);
      }
      for (let i = 0; i < counts.length; i++) if (counts[i] > 0) s.covered[i] = 1;
    }
  }

  const out = [];
  let fnTotal = 0, fnHit = 0, codeTotal = 0, codeHit = 0;
  const perScript = [];
  for (const { name, source, covered, fns } of scripts.values()) {
    const lineOf = (o) => source.slice(0, o).split("\n").length;
    const code = codeMask(source);
    let total = 0, hit = 0;
    for (let i = 0; i < source.length; i++) if (code[i]) { total++; if (covered[i]) hit++; }
    const list = [...fns.values()].sort((a, b) => a.start - b.start);
    const missed = list.filter((f) => !f.hit);
    fnTotal += list.length; fnHit += list.length - missed.length; codeTotal += total; codeHit += hit;

    const spots = [];
    for (let i = 0; i < source.length; ) {
      if (code[i] && !covered[i]) {
        let j = i;
        while (j < source.length && (!code[j] || !covered[j])) j++;
        const text = source.slice(i, j).trim().replace(/\s+/g, " ");
        if (text.length > 12) spots.push({ line: lineOf(i), text: text.slice(0, 90) }); // skip stray "}" etc.
        i = j;
      } else i++;
    }
    const fnPct = list.length ? ((list.length - missed.length) / list.length) * 100 : 100;
    perScript.push({ name, fnPct, functions: list.length, missed: missed.map((f) => ({ line: lineOf(f.start), name: f.name })), spots: spots.length });
    out.push(`\n${missed.length ? "•" : "✅"} ${name}`);
    out.push(`   functions: ${list.length - missed.length}/${list.length} (${fnPct.toFixed(1)}%)`);
    out.push(`   code:      ${total ? ((hit / total) * 100).toFixed(1) : "100.0"}% of non-comment characters executed`);
    if (missed.length) {
      out.push("   functions never run:");
      for (const f of missed) out.push(`     line ${String(lineOf(f.start)).padStart(4)}  ${f.name}`);
    }
    if (spots.length) {
      out.push(`   unexecuted code (${spots.length} spots):`);
      for (const s of spots.slice(0, MAX_SPOTS)) out.push(`     line ${String(s.line).padStart(4)}  ${s.text}`);
      if (spots.length > MAX_SPOTS) out.push(`     … ${spots.length - MAX_SPOTS} more`);
    }
  }
  const fnPct = fnTotal ? (fnHit / fnTotal) * 100 : 100;
  const codePct = codeTotal ? (codeHit / codeTotal) * 100 : 100;
  const ok = min == null || fnPct >= min;
  out.unshift(`JS coverage from ${files.length} test runs, ${scripts.size} app scripts`);
  out.push(`\n${ok ? "✅" : "❌"} total: functions ${fnHit}/${fnTotal} (${fnPct.toFixed(1)}%), code ${codePct.toFixed(1)}%${min != null ? `, min ${min}%` : ""}`);
  out.push("Each uncovered item: write the test, or note why it can't happen.");
  return { status: ok ? 0 : 1, fnPct, codePct, fnTotal, fnHit, perScript, text: out.join("\n") };
}

function readMin(argv) {
  const arg = argv.find((a) => a.startsWith("--min="));
  if (arg) return Number(arg.slice(6));
  try { return JSON.parse(fs.readFileSync("ui-coverage.json", "utf8")).thresholds?.jsFunctions ?? null; } catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = analyze({ min: readMin(process.argv) });
  if (process.argv.includes("--json")) console.log(JSON.stringify({ ...r, text: undefined }, null, 2));
  else (r.status === 2 ? console.error : console.log)(r.text);
  process.exit(r.status);
}
