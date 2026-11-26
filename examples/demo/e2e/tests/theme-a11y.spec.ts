// Layer 5 + theme: default theme, persistence, axe per screen/theme, Tab walk.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, open, reload } from "./fixtures";
import type { Page } from "@playwright/test";

const scan = async (page: Page) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length}× ${v.nodes[0].target}`)).toEqual([]);
};

test("default theme is light whatever the OS prefers", async ({ browser, baseURL }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ colorScheme, baseURL });
    const page = await ctx.newPage();
    await page.goto("/about");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await ctx.close();
  }
});

test("theme toggle relabels, persists across reload, and toggles back", async ({ page }) => {
  await open(page, "/about");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#theme")).toHaveAttribute("aria-pressed", "true");
  await reload(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

for (const theme of ["light", "dark"]) {
  test(`axe: list with filters open, ${theme} @responsive`, async ({ page, mockApi }) => {
    await mockApi("/api/books");
    await page.addInitScript((t) => localStorage.setItem("reading-list-theme", t), theme);
    await open(page);
    await page.getByRole("button", { name: "Filters" }).click(); // hidden content isn't scanned until shown
    await page.getByRole("button", { name: "Unread", exact: true }).click();
    await scan(page);
  });

  test(`axe: detail page with the dialog open, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("reading-list-theme", t), theme);
    await open(page, "/books/1");
    await scan(page);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await scan(page);
  });
}

test("axe: about page", async ({ page }) => {
  await open(page, "/about");
  await scan(page);
});

test("Tab walk: every control reachable, each with a visible focus ring", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  await open(page);
  const expected = await page.locator("a[href], button:not([disabled]), input, textarea, select, summary")
    .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).length);
  const seen = new Set<string>();
  const noRing: string[] = [];
  for (let i = 0; i < expected + 3; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect(); // rows repeat the same button text: position tells them apart
      return { key: `${el.tagName}|${el.textContent?.trim().slice(0, 30)}|${Math.round(r.top + scrollY)}:${Math.round(r.left)}`,
        ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none" };
    });
    if (info) { seen.add(info.key); if (!info.ring) noRing.push(info.key); }
  }
  expect(noRing).toEqual([]);
  expect(seen.size).toBeGreaterThanOrEqual(expected);
});
