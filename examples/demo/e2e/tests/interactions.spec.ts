// Layer 2: each control — its effect, its request, its busy state, its failure.
import { test, expect, open, allowConsoleErrors } from "./fixtures";
import type { Page } from "@playwright/test";

const rows = (page: Page) => page.locator("#books > li");

/** Fake PATCH /api/books/:id; returns the request bodies it received. */
async function mockPatch(page: Page, status = 200) {
  const bodies: any[] = [];
  await page.route("**/api/books/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    bodies.push(body);
    const id = Number(route.request().url().split("/").pop());
    await route.fulfill(status >= 400 ? { status, json: { error: "Could not save" } } : { json: { id, ...body } });
  });
  return bodies;
}

test("filters: disclosure toggles and each filter narrows the list", async ({ page, mockApi }) => {
  await mockApi("/api/books"); // book 1 is read, 2 and 3 are not
  await open(page);
  const toggle = page.getByRole("button", { name: "Filters" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#filters")).toBeHidden(); // what the user sees, not just the attribute
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#filters")).toBeVisible();

  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Unread", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Read", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);

  await page.getByRole("button", { name: "All" }).click();
  await expect(rows(page)).toHaveCount(3);

  await toggle.click();
  await expect(page.locator("#filters")).toBeHidden();
});

test("filters: Clear filter returns to every book", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  await open(page);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("button", { name: "Unread", exact: true }).click();
  await page.getByRole("button", { name: "Clear filter" }).click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Clear filter" })).toHaveCount(0);
});

test("mark read / unread: sends the new state and relabels the button", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  const bodies = await mockPatch(page);
  await open(page);
  await rows(page).nth(1).getByRole("button", { name: "Mark read" }).click();
  await expect(rows(page).nth(1).getByRole("button")).toHaveText("Mark unread");
  await rows(page).nth(0).getByRole("button", { name: "Mark unread" }).click();
  await expect(rows(page).nth(0).getByRole("button")).toHaveText("Mark read");
  expect(bodies).toEqual([{ read: true }, { read: false }]);
});

test("mark read failure: error shows and the button unlocks", async ({ page, mockApi }, info) => {
  allowConsoleErrors(info);
  await mockApi("/api/books");
  await mockPatch(page, 500);
  await open(page);
  const btn = rows(page).nth(1).getByRole("button", { name: "Mark read" });
  await btn.click();
  await expect(page.locator("#add-error")).toHaveText("Could not save");
  await expect(btn).toBeEnabled();
});

test("add: sends title and author, shows busy, then the new row", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  const bodies: any[] = [];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/books", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(route.request().postDataJSON());
    await held; // keep the request open so the busy state is observable
    await route.fulfill({ status: 201, json: { id: 9, title: "Clean Code", author: "Robert C. Martin", read: false } });
  });
  await open(page);
  await page.getByLabel("Title").fill("Clean Code");
  await page.getByLabel("Author").fill("Robert C. Martin");
  const submit = page.getByRole("button", { name: "Add book" });
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveAttribute("aria-busy", "true");
  release();
  await expect(rows(page)).toHaveCount(4);
  await expect(rows(page).last()).toContainText("Clean Code");
  expect(bodies).toEqual([{ title: "Clean Code", author: "Robert C. Martin" }]);
});

test("add: empty title is blocked before any request", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  let posted = 0;
  await page.route("**/api/books", (r) => (r.request().method() === "POST" ? (posted++, r.abort()) : r.fallback()));
  await open(page);
  await page.getByRole("button", { name: "Add book" }).click();
  await expect(page.locator("#add-error")).toHaveText("Give the book a title.");
  await expect(page.getByLabel("Title")).toBeFocused();
  expect(posted).toBe(0);
});

test("add: server rejection shows its message and unlocks the form", async ({ page, mockApi }, info) => {
  allowConsoleErrors(info);
  await mockApi("/api/books");
  await page.route("**/api/books", (r) => (r.request().method() === "POST"
    ? r.fulfill({ status: 400, json: { error: "Title is required" } }) : r.fallback()));
  await open(page);
  await page.getByLabel("Title").fill("   x");
  await page.getByRole("button", { name: "Add book" }).click();
  await expect(page.locator("#add-error")).toHaveText("Title is required");
  await expect(page.getByRole("button", { name: "Add book" })).toBeEnabled();
});

test("mark read: the button locks while its request is in flight", async ({ page, mockApi }) => {
  await mockApi("/api/books");
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/books/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await held;
    await route.fulfill({ json: { id: 2, read: true } });
  });
  await open(page);
  const btn = rows(page).nth(1).getByRole("button", { name: "Mark read" });
  await btn.click();
  await expect(btn).toBeDisabled();
  release();
  await expect(rows(page).nth(1).getByRole("button")).toHaveText("Mark unread");
});
