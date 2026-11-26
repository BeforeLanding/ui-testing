#!/usr/bin/env node
// lint-specs.mjs — catch hollow tests: the ones that go green whatever the UI does.
// AI-written suites are full of them, and a green run proves nothing while they exist.
//
// Usage (from the e2e/ directory):  node tools/lint-specs.mjs [tests-dir] [--json]
//
// Errors (exit 1):
//   only            test.only / describe.only left in
//   skip            test.skip / fixme without a reason string or a `// skip-ok: why` comment
//   no-assertion    a test that never calls expect*, a helper that does, or toHaveScreenshot
//   tautology       expect(true) / expect(1) …
//   truthy-locator  expect(page.locator(…)).toBeTruthy() — a Locator object is always truthy
//   unawaited       expect(locator).toBeVisible() without await — the test ends before it checks
//   force           click({ force: true }) skips the actionability checks that catch covered /
//                   disabled / invisible controls; allowed with `// force-ok: why`
// Warnings:
//   sleep           waitForTimeout without a comment saying which human pause it simulates
//   non-retrying    expect(await x.isVisible()).toBe(true) — use the web-first assertion
//   swallowed       empty catch / .catch(() => {}) in a test
//   ui-branch       if (await x.isVisible()) … — a missing element silently takes the other branch
//   loose-snapshot  screenshot tolerance looser than 1% of pixels
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Replace comment text and string contents with spaces; keeps offsets, newlines and quote chars. */
export function blank(src) {
  const out = src.split("");
  let i = 0;
  const wipe = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== "\n") out[k] = " "; };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? src.length : e; wipe(i, end); i = end; }
    else if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e + 2; wipe(i, end); i = end; }
    else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; if (c !== "`" && src[j] === "\n") break; j++; }
      wipe(i + 1, j); i = j + 1;
    } else i++;
  }
  return out.join("");
}

function matchClose(code, open) { // index of the bracket closing code[open]
  const pair = { "(": ")", "{": "}", "[": "]" }[code[open]];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === code[open]) depth++;
    else if (code[i] === pair && --depth === 0) return i;
  }
  return code.length - 1;
}

const ASYNC_MATCHER = /^\s*\.\s*(?:not\s*\.\s*)?(?:toBe(?:Visible|Hidden|Enabled|Disabled|Checked|Focused|InViewport|Attached|Editable|Empty|OK)|toHave(?:Text|Value|Values|Count|Attribute|Class|CSS|Id|URL|Title|Screenshot|AccessibleName|AccessibleDescription|Role|JSProperty)|toContainText|toPass)\s*\(/;

export function lintSource(src, file, helpers = []) {
  const code = blank(src);
  const lines = src.split("\n");
  const lineAt = (i) => code.slice(0, i).split("\n").length;
  const commentNear = (i, re) => { const l = lineAt(i); return [lines[l - 1], lines[l - 2] ?? ""].some((t) => re.test(t)); };
  const findings = [];
  const add = (sev, rule, i, msg) => findings.push({ file, line: lineAt(i), sev, rule, msg });
  const each = (re, fn) => { for (const m of code.matchAll(re)) fn(m); };

  each(/\b(?:test|it|describe)(?:\.describe)?\.only\s*\(/g, (m) => add("error", "only", m.index, "remove .only"));

  each(/\b(?:test|it)(?:\.describe)?\.(skip|fixme)\s*\(/g, (m) => {
    if (commentNear(m.index, /skip-ok:/)) return;
    const open = m.index + m[0].length - 1, close = matchClose(code, open);
    const args = code.slice(open + 1, close).trim();
    if (!args) return add("error", "skip", m.index, `${m[1]}() without a reason — pass (condition, "reason") or comment // skip-ok: why`);
    if (/^["'`]/.test(args)) return add("error", "skip", m.index, `a ${m[1]}ped test is untested UI — fix it, or comment // skip-ok: why`);
    if (!/,\s*["'`]/.test(args)) add("error", "skip", m.index, `conditional ${m[1]} needs a reason string`);
  });

  // Local helpers that assert count as assertions when a test calls them.
  const asserting = new Set(helpers);
  each(/(?:function\s+(\w+)\s*\(|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>)/g, (m) => {
    const brace = code.indexOf("{", m.index + m[0].length - 1);
    if (brace < 0) return;
    const body = code.slice(brace, matchClose(code, brace));
    if (/\bexpect\w*\s*[.(]|toHaveScreenshot/.test(body)) asserting.add(m[1] || m[2]);
  });
  const assertRe = new RegExp(String.raw`\bexpect\w*\s*[.(]|toHaveScreenshot` + (asserting.size ? String.raw`|\b(?:${[...asserting].join("|")})\s*\(` : ""));
  each(/\b(?:test|it)(?:\.(?:only|fail|slow))?\s*\(\s*["'`]/g, (m) => {
    const open = code.indexOf("(", m.index), close = matchClose(code, open);
    const title = src.slice(open + 1, close).match(/^\s*(["'`])((?:\\.|(?!\1).)*)\1/)?.[2] ?? "";
    if (!assertRe.test(code.slice(open, close))) add("error", "no-assertion", m.index, `"${title}" asserts nothing — it passes whatever the UI does`);
  });

  each(/\bexpect(?:\.soft)?\s*\(\s*(?:true|false|1|0|null|undefined)\s*\)/g, (m) => add("error", "tautology", m.index, "asserting a constant proves nothing"));

  each(/\bexpect\s*\(\s*\w+\s*\.\s*(?:locator|getBy\w+)\s*\([^()]*(?:\([^()]*\)[^()]*)*\)(?:\s*\.\s*(?:first|last|nth|filter|locator|getBy\w+)\s*\([^()]*(?:\([^()]*\)[^()]*)*\))*\s*\)\s*\.\s*(?:not\s*\.\s*)?(?:toBeTruthy|toBeDefined|toBeFalsy|toBeNull|toBeUndefined)\s*\(/g,
    (m) => add("error", "truthy-locator", m.index, "a Locator is always an object — use toBeVisible()/toHaveCount()"));

  each(/\bexpect(?:\.soft|\.poll)?\s*\(/g, (m) => {
    const before = code.slice(Math.max(0, m.index - 12), m.index);
    if (/(?:await|return|=>)\s*$/.test(before) || /[,[(]\s*$/.test(before)) return;
    const close = matchClose(code, m.index + m[0].length - 1);
    const isPoll = /\.poll/.test(m[0]);
    if (isPoll || ASYNC_MATCHER.test(code.slice(close + 1)))
      add("error", "unawaited", m.index, "web-first/poll assertion without await — the test can end before it checks");
  });

  each(/\bforce\s*:\s*true\b/g, (m) => { if (!commentNear(m.index, /force-ok:/)) add("error", "force", m.index, "force skips actionability checks; comment // force-ok: why"); });

  each(/\bwaitForTimeout\s*\(/g, (m) => { if (!commentNear(m.index, /\/\/|\/\*/)) add("warn", "sleep", m.index, "fixed sleep — wait for a state, or comment which human pause this simulates"); });
  each(/\bexpect\s*\(\s*await\s+[^;]*?\.\s*(?:isVisible|isHidden|isEnabled|isDisabled|isChecked|textContent|innerText|inputValue|getAttribute)\s*\([^)]*\)\s*\)\s*\./g,
    (m) => add("warn", "non-retrying", m.index, "one-shot read — prefer await expect(locator).toBeVisible()/toHaveText()…"));
  each(/\bcatch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}|\.catch\s*\(\s*\(?\s*\w*\s*\)?\s*=>\s*(?:\{\s*\}|undefined|null)\s*\)/g,
    (m) => add("warn", "swallowed", m.index, "swallowed error in a test"));
  each(/\bif\s*\(\s*!?\s*\(?\s*await\s+[^;{]*?\.\s*(?:isVisible|isHidden|isEnabled|count)\s*\(/g,
    (m) => add("warn", "ui-branch", m.index, "branching on what's on screen hides a missing element — assert the state instead"));
  each(/\b(maxDiffPixelRatio|maxDiffPixels|threshold)\s*:\s*(\d*\.?\d+)/g, (m) => {
    const v = Number(m[2]);
    if ((m[1] === "maxDiffPixelRatio" && v > 0.01) || (m[1] === "maxDiffPixels" && v > 100) || (m[1] === "threshold" && v > 0.3))
      add("warn", "loose-snapshot", m.index, `${m[1]}: ${m[2]} lets real visual regressions through`);
  });
  return findings.sort((a, b) => a.line - b.line);
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? (d.name === "node_modules" ? [] : walk(path.join(dir, d.name)))
      : /\.(spec|test)\.[cm]?[jt]sx?$/.test(d.name) ? [path.join(dir, d.name)] : []);
}

export function lint({ dir = "tests", root = "." } = {}) {
  let helpers = [];
  try { helpers = JSON.parse(fs.readFileSync(path.join(root, "ui-coverage.json"), "utf8")).assertionHelpers ?? []; } catch {}
  const files = walk(path.resolve(root, dir));
  const findings = files.flatMap((f) => lintSource(fs.readFileSync(f, "utf8"), path.relative(root, f).replace(/\\/g, "/"), helpers));
  const errors = findings.filter((f) => f.sev === "error").length;
  const warnings = findings.length - errors;
  const text = [
    `Spec lint: ${files.length} spec files, ${errors} errors, ${warnings} warnings`,
    ...findings.map((f) => `  ${f.sev === "error" ? "❌" : "⚠️ "} ${f.file}:${f.line}  [${f.rule}] ${f.msg}`),
  ].join("\n");
  return { status: errors ? 1 : 0, files: files.length, errors, warnings, findings, text };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "tests";
  const r = lint({ dir });
  console.log(process.argv.includes("--json") ? JSON.stringify({ ...r, text: undefined }, null, 2) : r.text);
  process.exit(r.status);
}
