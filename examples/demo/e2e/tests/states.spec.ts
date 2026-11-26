// Layer 3: every region in every state, forced through network mocks.
import { test, expect, open, allowConsoleErrors, expectNoHorizontalOverflow } from "./fixtures";

const rows = (page) => page.locator("#books > li");

test("populated: renders every book with its author @responsive", async ({ page, mockApi }) => {
  const d = await mockApi("/api/books");
  await open(page);
  await expect(rows(page)).toHaveCount(d.books.length);
  await expect(rows(page).first()).toContainText("The Pragmatic Programmer");
  await expect(rows(page).first()).toContainText("Hunt & Thomas");
  await expectNoHorizontalOverflow(page);
});

test("empty: first-run prompt focuses the title field", async ({ page, mockApi }) => {
  await mockApi("/api/books", (d) => { d.books = []; });
  await open(page);
  await expect(page.getByText("No books yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add your first book" }).click();
  await expect(page.getByLabel("Title")).toBeFocused();
});

test("loading: slow response shows a skeleton, then the list", async ({ page, mockApi }) => {
  await mockApi("/api/books", undefined, { delayMs: 1200 });
  await page.goto("/");
  await expect(page.locator(".skeleton").first()).toBeVisible();
  await expect(rows(page)).toHaveCount(3, { timeout: 5000 });
  await expect(page.locator(".skeleton")).toHaveCount(0);
});

test("error: failure explains itself and Try again recovers", async ({ page, mockApi }, info) => {
  allowConsoleErrors(info); // the browser logs the 500
  await mockApi("/api/books", undefined, { status: 500 });
  await open(page);
  await expect(page.getByRole("alert")).toContainText("Couldn't load your books");
  await page.unroute("**/api/books");
  await mockApi("/api/books");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(rows(page)).toHaveCount(3);
});

test("edge: long title truncates and the page never scrolls sideways @responsive", async ({ page, mockApi }) => {
  const LONG = "An extraordinarily long book title that keeps going ".repeat(4).trim();
  await mockApi("/api/books", (d) => { d.books[0].title = LONG; });
  await open(page);
  await expectNoHorizontalOverflow(page);
  const title = page.locator("#books .title").first();
  await expect(title).toHaveAttribute("title", LONG); // full text still reachable
  expect(await title.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true); // visibly truncated
});

test("edge: hostile title renders as text and never runs", async ({ page, mockApi }) => {
  const evil = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
  await mockApi("/api/books", (d) => { d.books[0].title = evil; });
  await open(page);
  await expect(page.locator("#books .title").first()).toHaveText(evil);
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test("edge: missing author shows a placeholder", async ({ page, mockApi }) => {
  await mockApi("/api/books", (d) => { delete d.books[1].author; });
  await open(page);
  await expect(rows(page).nth(1)).toContainText("Unknown author");
});

test("edge: a filter with no matches says so", async ({ page, mockApi }) => {
  await mockApi("/api/books", (d) => { d.books.forEach((b) => (b.read = false)); });
  await open(page);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(page.getByText("Nothing matches this filter.")).toBeVisible();
});

test("edge: a non-JSON error (proxy 502) still explains itself", async ({ page, mockApi }, info) => {
  allowConsoleErrors(info);
  await mockApi("/api/books");
  await page.route("**/api/books/*", (r) => (r.request().method() === "PATCH"
    ? r.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" }) : r.fallback()));
  await open(page);
  await rows(page).nth(1).getByRole("button", { name: "Mark read" }).click();
  await expect(page.locator("#add-error")).toHaveText("Request failed (502)");
});

test("edge: detail page without an author shows a placeholder", async ({ page }) => {
  await page.route("**/api/books/2", (r) => r.fulfill({ json: { id: 2, title: "Untitled draft", read: false } }));
  await open(page, "/books/2");
  await expect(page.locator(".author")).toHaveText("Unknown author");
});
