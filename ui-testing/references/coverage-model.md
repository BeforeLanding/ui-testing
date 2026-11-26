# Coverage model

What the gate counts, exactly, so "100%" means something specific — and what it
can't see.

## Contents
- [Element keys](#element-keys)
- [What counts as an element](#what-counts-as-an-element)
- [The denominator](#the-denominator)
- [What counts as interacted](#what-counts-as-interacted)
- [Collections and site chrome](#collections-and-site-chrome)
- [Ignore rules](#ignore-rules)
- [State matrix verification](#state-matrix-verification)
- [What 100% does not mean](#what-100-does-not-mean)
- [Troubleshooting](#troubleshooting)

## Element keys

`tools/ui-probe.js` is injected into every page, by the crawler and by the test
fixture alike, so both name an element identically:

```
/books/:id | dialog "Delete this book?" | button "Delete book"
└─ route ─┘ └──────── region ─────────┘   └─ role "accessible name" ─┘
```

- **route**: `location.pathname`, numeric and hex/uuid segments → `:id`; a `#/…` hash route is appended. Elements in `header`, `nav`, `footer` (and their ARIA roles) get route `*`: the theme toggle is one control, not one per page.
- **region**: the nearest dialog, `data-testid` container, element with a stable `id`, labelled section/landmark, or landmark tag. Ids that look generated (`:r1:`, `radix-…`, three+ digits) are skipped.
- **role**: explicit `role`, else implied by the tag (`a[href]` → link, `input[type=checkbox]` → checkbox, `select` → combobox …). `clickable` = pointer cursor or `onclick` with no semantics; `focusable` = a non-control with `tabindex ≥ 0`.
- **name**: `aria-labelledby` → `aria-label` → `<label>` → button value → placeholder/title/name → visible text → icon alt/title. Digits become `#` so "Inbox (3)" and "Inbox (4)" are one control. `data-testid` replaces role + name when present.

## What counts as an element

Visible elements matching: `a[href]`, `button`, `input` (not hidden), `select`,
`textarea`, `summary`, `contenteditable`, `[onclick]`, ARIA widget roles (button,
link, checkbox, radio, switch, tab, menuitem*, option, combobox, slider,
spinbutton, textbox, searchbox, treeitem, gridcell), `[tabindex]` ≥ 0 — plus
**role-less clickables**: the outermost element where `cursor: pointer` starts,
which is how React/Vue click handlers on `<div>`s show up. Those are also reported
as an accessibility smell.

Visible = has a box, passes `checkVisibility()` (opacity and visibility), not inside
`[inert]`, `[aria-hidden=true]` or a closed `<details>` (its `summary` counts). A
visually hidden checkbox styled through its `<label>` counts if the label is visible.

Disabled elements are recorded with `disabled: true`. One that is never seen
enabled is listed separately ("only ever seen disabled") and left out of the
percentage: either a state should enable it (add the matrix cell and test) or it
should be ignored with a reason.

## The denominator

```
denominator = crawler inventory ∪ everything any test saw on screen − ignored − only-ever-disabled
```

- **Crawler** (`tests/inventory.crawl.ts`): starts at `crawl.routes`, follows
  same-origin links (up to `maxRoutes`), and on each route clicks every control
  (`reveal: "all"`) or only disclosure controls (`"disclosure"`: `aria-expanded`,
  `aria-haspopup`, `summary`, tabs, `popovertarget`) — each in a fresh browser
  context, with every non-GET request aborted and `confirm()` dismissed. It records
  what is visible after each click, one level deep.
- **Tests**: the fixture reports every visible control on page load, after each DOM
  change (debounced 200 ms), right before each interaction, and at the end of the
  test. This is how state-only controls (error "Try again", empty-state CTAs, busy
  labels, deeper menus) enter the denominator: the crawler sees the populated state,
  the tests that force other states add theirs.

Consequence: a state no test reaches and the crawler can't reach is invisible to the
UI metric. That is what the **state matrix** is for — it names states, not elements.

## What counts as interacted

A capture-phase listener records the element for: `click` (also what `check()`,
`tap()`, label clicks produce), `input` and `change` (`fill`, `type`,
`selectOption`, `setInputFiles`), `submit`, and `keydown` of activation/navigation
keys (Enter, Space, arrows, Home/End, PageUp/PageDown) on a focused control.

Not counted: focus alone (a Tab walk would mark everything), hover, scroll, Tab and
other keys. Interaction is recorded **before** the app reacts, so a button that
relabels itself ("Save" → "Saving…") is credited under its rest name.

## Collections and site chrome

Lists rendered from data would otherwise inflate the denominator: 40 rows → 40 links
"untested". Add the row selector to `collections`:

```json
"collections": ["#books > li", "table.orders tbody tr"]
```

Inside a matching item, roles that are usually named by the row's *data* — link,
clickable, focusable, option, treeitem, gridcell — are keyed `{item}`. Buttons and
fields keep their label: "Mark read" and "Mark unread" are two controls, each needing
a test, while one click on one book link covers "book link". The report suggests
candidates ("possible data-driven lists": ≥ 5 same-role elements in one region).

## Ignore rules

```json
"ignore": [
  { "match": "| #admin-debug |", "reason": "dev-only panel, stripped from production builds" },
  { "match": "/\\| link \"(Terms|Privacy)\"/", "reason": "static legal links, checked by the link checker in CI" }
]
```

`match` is a substring of the key, or `/regex/flags`. A rule without a reason of at
least a few words is a config error (gate fails); a rule that matches nothing is
reported as stale. Every ignore rule is UI you decided not to test — tell the user.

## State matrix verification

`state-matrix.md` tables are parsed row by row (rows whose label starts with `e.g.`
and all-empty rows are skipped). Each cell must be:

- `spec › test title` references, `;`-separated — `spec` is the file name without
  `.spec.ts`, the title may include `describe` titles, matching is case-insensitive
  and ignores `@tags`. Each must exist in `.results.json` (the JSON reporter's output
  of the last run) **and have passed** in at least one project.
- `n/a: <reason>` (at least a few words).

An empty cell, an unknown test, a failed or skipped test, or a bare `n/a` fails the gate.

## What 100% does not mean

- **Interacted ≠ verified.** The metric proves a test operated the control; whether
  it then checked the effect is up to the test. The linter rejects tests with no
  assertion at all; the skill requires an assertion after every interaction.
- **One element, one interaction.** A form field typed into once counts as covered;
  its validation states are matrix cells, not elements.
- **Crawl depth is one click.** Deeper UI enters the denominator only when a test
  reaches it. Multi-step wizards need explicit matrix rows.
- **Not inventoried**: canvas/WebGL hit areas, drag-and-drop targets, hover-only
  menus, controls inside cross-origin iframes, closed shadow roots.
- **JS coverage** is per script URL as served (no source maps); bundlers merge
  vendor code unless `APP_SCRIPT_MATCH` excludes it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A control a test clearly clicks is "never interacted" | Its key differs between crawl and test: name changes with data, or region id is generated | Add a `data-testid`, a stable `id` on the region, or the row selector to `collections` |
| Same control listed once per page | It lives outside `header`/`nav`/`footer` | Move it into the landmark, or ignore the duplicates with a reason |
| Hundreds of "clickable" elements | A wrapper sets `cursor: pointer` on non-interactive content | Fix the CSS — users see a pointer that does nothing — or ignore with a reason |
| Crawler finds 0 elements | `prepare()` mocks don't match, or the app needs login | Fix `prepare()`; for login, add `storageState` to the crawl context |
| Crawl too slow | `reveal: "all"` × many controls × many routes | Lower `maxRevealsPerRoute`, use `"disclosure"`, or `--skip-crawl` while iterating |
| Matrix says a test "did not pass" although it did | The ref matched a different project's skipped run only | Check the title path; refs must match the spec stem and the end of the title path |
