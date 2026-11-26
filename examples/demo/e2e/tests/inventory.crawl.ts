/**
 * UI inventory crawler (template from the ui-testing skill).
 *
 * Builds the DENOMINATOR of UI coverage mechanically, instead of trusting a
 * hand-written list: it opens every route, follows same-origin links, clicks
 * each control once in a fresh page to reveal menus/dialogs/tabs, and writes
 * every visible interactive element it found to .ui-inventory.json.
 *
 * Run through the gate (`node tools/ui-gate.mjs`) or directly:
 *   UI_INVENTORY=1 npx playwright test --project=inventory
 *
 * Safety: every non-GET request is aborted, so revealing clicks can't create,
 * delete or pay for anything. Still run it only against the deterministic test
 * server from playwright.config.ts, and list logout-style routes in skipRoutes.
 *
 * EDIT prepare(): the same mocks your tests use for the "populated" state.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, mockApiOn, installProbe, UI_CONFIG, allowConsoleErrors } from "./fixtures";
import type { Browser, Page } from "@playwright/test";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".ui-inventory.json");
const cfg = {
  routes: ["/"] as string[],
  skipRoutes: [] as string[],
  maxRoutes: 40,
  reveal: "all" as "all" | "disclosure" | "none",
  maxRevealsPerRoute: 60,
  ...(UI_CONFIG.crawl ?? {}),
};

/** EDIT: put the app into its realistic, populated state. */
async function prepare(page: Page) {
  await mockApiOn(page, "/api/books");
}

type Rec = { key: string; route: string; [k: string]: unknown };

test("crawl the UI inventory", async ({ browser, baseURL }, info) => {
  allowConsoleErrors(info); // aborted writes log errors; the crawl isn't a test of the app
  test.setTimeout(15 * 60_000);
  const origin = new URL(baseURL!).origin;
  const elements = new Map<string, Rec & { foundBy: string }>();
  const skip = cfg.skipRoutes.map((s: string) => new RegExp(s));
  const queue: string[] = [...cfg.routes];
  const visited = new Set<string>();
  const routeKeys = new Set<string>();

  const fresh = async (browser: Browser, url: string) => {
    const ctx = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
    await installProbe(ctx);
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.dismiss().catch(() => {}));
    await page.route("**/*", (r) => (/^(GET|HEAD|OPTIONS)$/.test(r.request().method()) ? r.fallback() : r.abort()));
    await prepare(page);
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300); // let client rendering settle; this is a crawl, not an assertion
    return { ctx, page };
  };
  const collect = async (page: Page, foundBy: string) => {
    const recs: Rec[] = await page.evaluate(() => (window as any).__uiProbe.enumerate());
    for (const r of recs) if (!elements.has(r.key)) elements.set(r.key, { ...r, foundBy });
    return recs;
  };
  const links = (page: Page) => page.evaluate((o) => [...document.querySelectorAll("a[href]")]
    .map((a) => new URL((a as HTMLAnchorElement).href, location.href))
    .filter((u) => u.origin === o)
    .map((u) => u.pathname + (u.hash.startsWith("#/") ? u.hash : "")), origin);
  const routeOf = (page: Page) => page.evaluate(() => (window as any).__uiProbe.route());

  while (queue.length && visited.size < cfg.maxRoutes) {
    const url = queue.shift()!;
    if (visited.has(url) || skip.some((r: RegExp) => r.test(url))) continue;
    visited.add(url);
    const { ctx, page } = await fresh(browser, url);
    const route = await routeOf(page);
    if (routeKeys.has(route)) { await ctx.close(); continue; } // /items/1 and /items/2 are one route
    routeKeys.add(route);
    await collect(page, `load ${url}`);
    for (const l of await links(page)) if (!visited.has(l)) queue.push(l);
    const candidates: string[] = cfg.reveal === "none" ? [] :
      (await page.evaluate((m) => (window as any).__uiProbe.revealers(m), cfg.reveal)).slice(0, cfg.maxRevealsPerRoute);
    await ctx.close();

    for (const key of candidates) {
      const { ctx, page } = await fresh(browser, url);
      try {
        if (!(await page.evaluate((k) => (window as any).__uiProbe.mark(k), key))) continue;
        await page.locator("[data-ui-probe-target]").first().click({ timeout: 2000 });
        await page.waitForTimeout(400); // menus/dialogs animate in
        await collect(page, `after clicking ${key}`);
        if (new URL(page.url()).pathname !== new URL(url, origin).pathname) {
          const moved = new URL(page.url());
          queue.push(moved.pathname + (moved.hash.startsWith("#/") ? moved.hash : ""));
        }
      } catch { /* a control that can't be clicked from rest state; tests will still see it */ }
      finally { await ctx.close(); }
    }
  }

  const list = [...elements.values()].sort((a, b) => a.key.localeCompare(b.key));
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), routes: [...routeKeys], elements: list }, null, 2));
  console.log(`inventory: ${list.length} elements on ${routeKeys.size} routes → ${OUT}`);
  expect(list.length, "crawler found no interactive elements — check prepare() and READY state").toBeGreaterThan(0);
});
