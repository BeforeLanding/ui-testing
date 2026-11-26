// Navigation: links, highlight, deep links, the detail page and its dialog.
import { test, expect, open, allowConsoleErrors } from "./fixtures";

const current = (page) => page.locator('nav a[aria-current="page"]');

test("nav: About and Books each highlight exactly themselves", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  await open(page);
  await expect(current(page)).toHaveText(["Books"]);
  await page.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  await expect(current(page)).toHaveText(["About"]);
  await page.getByRole("link", { name: "Books" }).click();
  await expect(page.getByRole("heading", { name: "Books" })).toBeVisible();
  await expect(current(page)).toHaveText(["Books"]);
});

test("about: external link opens a new tab safely", async ({ page, context }) => {
  await context.route("https://playwright.dev/**", (r) => r.fulfill({ body: "docs" })); // stay offline
  await open(page, "/about");
  const link = page.getByRole("link", { name: "Playwright docs" });
  await expect(link).toHaveAttribute("rel", /noopener/);
  const [popup] = await Promise.all([page.waitForEvent("popup"), link.click()]);
  expect(popup.url()).toContain("playwright.dev");
});

test("book link opens its detail page and back returns", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  await open(page);
  await page.getByRole("link", { name: "Refactoring" }).click();
  await expect(page).toHaveURL(/\/books\/3$/);
  await expect(page.getByRole("heading", { name: "Refactoring" })).toBeVisible();
  await expect(current(page)).toHaveText(["Books"]);
  await page.getByRole("link", { name: "← All books" }).click();
  await expect(page.locator("#books > li")).toHaveCount(3);
});

test("deep link: /books/2 renders without visiting the list", async ({ page }) => {
  await open(page, "/books/2");
  await expect(page.getByRole("heading", { name: "Designing Data-Intensive Applications" })).toBeVisible();
});

test("missing book: explains and links home", async ({ page, mockApi }, info) => {
  allowConsoleErrors(info); // the browser logs the 404
  await mockApi("/api/books");
  await open(page, "/books/99");
  await expect(page.getByRole("alert")).toContainText("Not found");
  await page.getByRole("link", { name: "Back to books" }).click();
  await expect(page.locator("#books > li")).toHaveCount(3);
});

test("delete: dialog opens, Cancel keeps the book, Delete removes it", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  const deleted: string[] = [];
  await page.route("**/api/books/*", (r) => r.request().method() === "DELETE"
    ? (deleted.push(r.request().url()), r.fulfill({ json: { ok: true } })) : r.fallback());
  await open(page, "/books/3");
  const dialog = page.getByRole("dialog", { name: "Delete this book?" });

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(deleted).toEqual([]);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete book" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(deleted).toHaveLength(1);
  expect(deleted[0]).toMatch(/\/api\/books\/3$/);
});
