/**
 * Shared fixtures (template from the ui-testing skill).
 *
 * Every test gets:
 *  - strict console: any pageerror / console.error fails the test, unless it
 *    calls allowConsoleErrors(testInfo) (for deliberate 4xx/5xx).
 *  - JS coverage of the app's own scripts (URLs matching APP_SCRIPT_MATCH),
 *    written to .coverage/ for tools/coverage-report.mjs.
 *  - UI coverage: tools/ui-probe.js records every interactive element the test
 *    SAW and every one it INTERACTED with, written to .ui-coverage/ for
 *    tools/ui-coverage.mjs.
 *  - mockApi(path, mutate?, opts?): serve a snapshot from fixtures/ (cloned,
 *    optionally mutated) for GET <path>.
 *  - mockJob(path, opts?): fake a background job — POST path returns {job},
 *    GET <JOB_POLL_PATH><id> returns "running" steps, then done or error.
 *    EDIT JOB_POLL_PATH if your app polls elsewhere; delete if unused.
 *
 * EDIT: DEFAULT_SNAPSHOT, READY_SELECTOR, SETTLED.
 */
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const FIXTURES = path.join(ROOT, "fixtures");
const COVERAGE_DIR = path.join(ROOT, ".coverage");
const UI_COVERAGE_DIR = path.join(ROOT, ".ui-coverage");
export const PROBE = path.join(ROOT, "tools", "ui-probe.js");
export const UI_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "ui-coverage.json"), "utf8"));

const DEFAULT_SNAPSHOT = "snapshot.json"; // GET /api/books from the seeded server
const READY_SELECTOR = "main h1, [role=alert]";
// EDIT: true once entrance animations are finished. Screenshots and axe MUST see the settled UI.
const SETTLED = () => !document.querySelector(".skeleton"); // the demo has no entrance animation
const JOB_POLL_PATH = "/api/jobs/"; // EDIT or delete with mockJob
const APP_SCRIPT = new RegExp(process.env.APP_SCRIPT_MATCH ?? "/static/");

export const snapshot = (name = DEFAULT_SNAPSHOT) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

type Data = Record<string, any>;
type Mutate = (d: Data) => Data | void;
type ApiOpts = { delayMs?: number; status?: number; fixture?: string; method?: string };
type JobOpts = { steps?: string[]; error?: string; result?: unknown; holdMs?: number };

/** Plain function form of the mockApi fixture, for pages/contexts the fixture doesn't own (the crawler). */
export async function mockApiOn(page: Page, urlPath: string, mutate?: Mutate, opts: ApiOpts = {}) {
  const data = snapshot(opts.fixture);
  const out = (mutate && mutate(data)) || data;
  await page.route(`**${urlPath}`, async (route) => {
    if (route.request().method() !== (opts.method ?? "GET")) return route.fallback();
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const failing = (opts.status ?? 200) >= 400;
    await route.fulfill({ status: opts.status ?? 200, json: failing ? { error: "Server exploded" } : out });
  });
  return out;
}

/** Load the probe (and the collection selectors it needs) into a page or context. */
export async function installProbe(target: Page | import("@playwright/test").BrowserContext) {
  await target.addInitScript((sel) => { (window as any).__uiCollections = sel; }, UI_CONFIG.collections ?? []);
  await target.addInitScript({ path: PROBE });
}

// Chrome drops a page's coverage when it navigates away, so coverage gathered
// before a reload would be lost (and reported as "never run"). reload() saves it first.
const earlier = new WeakMap<Page, any[]>();

/** Reload without losing the JS coverage collected so far. Use instead of page.reload(). */
export async function reload(page: Page) {
  earlier.get(page)?.push(...(await page.coverage.stopJSCoverage()));
  await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.reload();
}

export function allowConsoleErrors(info: TestInfo) {
  info.annotations.push({ type: "allow-console-errors" });
}

const fileId = (info: TestInfo) => `${info.project.name}-${info.testId}`.replace(/[^a-z0-9-]/gi, "_");

export const test = base.extend<{
  mockApi: (urlPath: string, mutate?: Mutate, opts?: ApiOpts) => Promise<Data>;
  mockJob: (urlPath: string, opts?: JobOpts) => Promise<{ bodies: unknown[] }>;
}>({
  page: async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

    const seen = new Map<string, any>();
    const hits = new Map<string, any>();
    await page.exposeBinding("__uiSeen", (_src, recs: any[]) => {
      for (const r of recs) {
        const prev = seen.get(r.key);
        if (!prev || (prev.disabled && !r.disabled)) seen.set(r.key, r);
      }
    });
    await page.exposeBinding("__uiHit", (_src, r: any) => { if (!hits.has(r.key)) hits.set(r.key, r); });
    await installProbe(page);

    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    earlier.set(page, []);
    await use(page);

    await page.evaluate(() => (window as any).__uiProbe?.report()).catch(() => {}); // final screen state
    const cov = [...(earlier.get(page) ?? []), ...(await page.coverage.stopJSCoverage())]
      .filter((e) => APP_SCRIPT.test(e.url) && !e.url.includes("node_modules"));
    const id = fileId(testInfo);
    if (cov.length) {
      fs.mkdirSync(COVERAGE_DIR, { recursive: true });
      fs.writeFileSync(path.join(COVERAGE_DIR, `${id}.json`), JSON.stringify(cov));
    }
    if (seen.size || hits.size) {
      fs.mkdirSync(UI_COVERAGE_DIR, { recursive: true });
      fs.writeFileSync(path.join(UI_COVERAGE_DIR, `${id}.json`), JSON.stringify({
        test: [path.basename(testInfo.file), ...testInfo.titlePath.slice(1)].join(" › "),
        seen: [...seen.values()], hits: [...hits.values()],
      }));
    }
    if (!testInfo.annotations.some((a) => a.type === "allow-console-errors")) {
      expect(errors, "unexpected console errors").toEqual([]);
    }
  },

  mockApi: async ({ page }, use) => {
    await use((urlPath, mutate, opts) => mockApiOn(page, urlPath, mutate, opts));
  },

  mockJob: async ({ page }, use) => {
    let n = 0;
    await use(async (urlPath, opts = {}) => {
      const bodies: unknown[] = [];
      const id = `job${++n}`;
      const steps = opts.steps ?? [];
      let polls = 0;
      await page.route(`**${urlPath}`, async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        bodies.push(route.request().postDataJSON());
        polls = 0;
        await route.fulfill({ json: { job: id } });
      });
      await page.route(`**${JOB_POLL_PATH}${id}`, async (route) => {
        if (opts.holdMs) await new Promise((r) => setTimeout(r, opts.holdMs));
        const i = polls++;
        if (i < steps.length) return route.fulfill({ json: { id, status: "running", message: steps[i] } });
        if (opts.error) return route.fulfill({ json: { id, status: "error", error: opts.error } });
        return route.fulfill({ json: { id, status: "done", result: opts.result ?? true } });
      });
      return { bodies };
    });
  },
});

export { expect };

/** Load a page and wait for real content AND settled animations. */
export async function open(page: Page, url = "/") {
  await page.goto(url);
  await page.locator(READY_SELECTOR).first().waitFor();
  await page.waitForFunction(SETTLED);
}

/** No element may make the page scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "page scrolls horizontally").toBeLessThanOrEqual(iw);
}
