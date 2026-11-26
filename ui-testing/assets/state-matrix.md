# UI state matrix

Start from the machine-generated draft (`node tools/ui-coverage.mjs --draft-matrix`
writes `state-matrix.draft.md` with one row per control the crawler found), then
add the regions and states only a human can name.

Each cell is one of:

- one or more test references `spec › test title`, separated by `;` — e.g.
  `states › empty list shows first-run prompt`. `spec` is the file name without
  `.spec.ts`; the title may include its `describe` path. The gate checks that every
  reference is a real test **and that it passed in the last run**.
- `n/a: <reason>` — the state can't happen here, with a reason a reviewer can check.
- empty — a gap. The gate fails while any cell is empty.

## Regions

| Region | Populated | Empty | Loading | Error | Edge (long text / huge numbers / hostile HTML / missing fields / 1 vs many) |
|---|---|---|---|---|---|
| _e.g. Items list_ | states › renders every item | states › empty list shows first-run prompt | states › slow load shows skeleton | states › load failure explains and retries | states › long title truncates; states › hostile title renders as text |

## Controls

| Control | Effect + request | Hover | Pressed | Focus-visible | Disabled | Busy | Failure |
|---|---|---|---|---|---|---|---|
| _e.g. Add item_ | interactions › add sends the title | n/a: no hover style by design | theme-a11y › primary button states | theme-a11y › Tab walk | interactions › empty title disables add | interactions › add shows busy state | interactions › add failure shows toast |

## Cross-cutting

| Concern | Test |
|---|---|
| Default theme (both OS settings) | |
| Theme toggle persists | |
| axe: each theme, each screen, expanded | |
| Keyboard: every control reachable, visible focus | |
| Reduced motion | |
| Small screen: no sideways scroll | |
| Visual baselines: theme × viewport | |
