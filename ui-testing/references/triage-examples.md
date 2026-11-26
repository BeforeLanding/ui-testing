# Triage examples

Real failures, sorted by which side was wrong. Use them to recognise the pattern quickly.
Rows marked **(dashboard)** come from the original
[viviannnl/ui-testing](https://github.com/viviannnl/ui-testing) suite (99 tests on a
local dashboard); rows marked **(demo)** from building `examples/demo` with this skill.

## App bugs (fix the app, keep the test)

| Symptom | Found by | Cause | Fix |
|---|---|---|---|
| Long book title made the page 2036 px wide **(demo)** | states › edge: long title truncates | `text-overflow: ellipsis` on a link inside a flex child that had `min-width: auto`, so the child grew instead of truncating | `min-width: 0` on the flex child |
| "← All books" link failed contrast, dark theme only **(demo)** | axe scan per theme × screen | Only list links were styled; this one kept the browser's default blue on a dark background | Style `a` globally with the theme accent |
| Filter panel always visible although `aria-expanded="false"` **(demo)** | interactions › disclosure test asserting `toBeHidden()` | `.filters { display: flex }` overrode the `hidden` attribute's `display: none` | `[hidden] { display: none !important }`; test asserts visibility, not just ARIA |
| "clear filter" was a `<span>` with a click handler **(demo)** | UI report: clickable without a role | Not focusable, not announced as a control | Make it a `<button>` |
| axe `color-contrast` on the primary button, light theme only **(dashboard)** | axe scan per theme | White text on a teal accent measured below 4.5:1; teal needs a darker shade than blue at the same lightness | Light theme uses one shade darker for primary fills; probe measured 5.65:1 |
| Clicking "Readiness" in the sidebar highlighted "Today" **(dashboard)** | user report → navigation spec | Scroll-tracking picked the topmost panel; in a two-column layout two panels share the top | A click selects outright; manual scroll releases it |
| PageDown after a sidebar jump never moved the highlight **(dashboard)** | coverage report (release branch never ran) | Release only listened when focus was on `<body>`, but the jump focuses the panel heading | Release on scroll keys unless focus is in a text field |
| Theme appeared light although dark is the default **(dashboard)** | user report → theme spec | An older build stored the theme under the same key | New storage key; test pre-seeds the stale key |
| Dark theme partly overridden on dark-mode OS **(dashboard)** | theme spec comparing computed background | A `prefers-color-scheme` rule had higher selector specificity than the theme layer | Raise the theme selector to the same specificity, later in the cascade |
| Focal border rendered lavender instead of teal **(dashboard)** | visual review of a screenshot | `color-mix(in oklch, accent, transparent-white)` interpolated hue | Mix in sRGB |

## Test bugs (fix the expectation, comment why)

| Symptom | Real cause | Fix |
|---|---|---|
| Strict-mode violation: `getByRole("button", { name: "Unread" })` matched 2 elements **(demo)** | Accessible-name matching is substring by default; "Mark unread" contains "Unread" | `exact: true` |
| Tab walk "expected ≥ 16, saw 15" **(demo)** | The walk keyed stops by tag + text; two rows' "Mark read" buttons collapsed into one | Add the element's position to the key |
| Tab walk "expected ≥ 150, saw 74" **(dashboard)** | Links inside a closed `<details>` have `offsetParent` in Chrome but are not tabbable | Exclude closed-`details` content (except `summary`) from the expected count |
| Wheel scroll after a click didn't change the highlight **(dashboard)** | Wheel fired during the click's smooth scroll; the browser finished the programmatic scroll | Wait for the smooth scroll to settle, as a person would |
| axe contrast failure only sometimes **(dashboard)** | Scan ran while panels were still fading in (opacity < 1 lowers real contrast) | `open()` waits for the first-paint animation class to clear |

## Tool bugs (fix the harness)

| Symptom | Real cause | Fix |
|---|---|---|
| The same row button was "untested" in the inventory but "covered" in tests **(demo)** | Collection keys depended on what the *other* rows were called at that moment, so the crawl and the test named it differently | Deterministic rule: inside a collection, data-named roles (links…) become `{item}`, buttons keep their label |
| Coverage report says a branch never ran, but a passing test asserts its output **(dashboard)** | The test reloaded the page; Chrome discards a page's coverage on navigation, so only the last load was recorded | `reload(page)` helper stops and saves coverage, restarts it, then reloads |

## Intentional design (assert the intent)

| Symptom | Intent | Fix |
|---|---|---|
| Busy button cursor was `progress`, test expected `not-allowed` **(dashboard)** | Busy ≠ disabled: busy shows progress, disabled shows not-allowed | Assert both states separately |

## Probe pattern

When the cause isn't obvious, write a throwaway spec that prints measurements, run it, delete it:

```ts
test("probe", async ({ page, mockApi }) => {
  await mockApi("/api/dashboard"); await open(page);
  await page.locator('[data-nav="readiness"]').click();
  for (const t of [100, 400, 900]) {
    await page.waitForTimeout(t);
    console.log(t, await page.evaluate(() => [scrollY, document.querySelector('[aria-current]')?.textContent]));
  }
});
```
