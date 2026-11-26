# UI state matrix — demo reading list

Started from `npm run draft-matrix` (23 controls found by the crawler and the tests),
then grouped by region. Every cell names a test the gate checks exists and passed,
or says why the state can't happen.

## Regions

| Region | Populated | Empty | Loading | Error | Edge (long text / huge numbers / hostile HTML / missing fields / 1 vs many) |
|---|---|---|---|---|---|
| Books list `/` | states › populated: renders every book with its author | states › empty: first-run prompt focuses the title field | states › loading: slow response shows a skeleton, then the list | states › error: failure explains itself and Try again recovers | states › edge: long title truncates and the page never scrolls sideways; states › edge: hostile title renders as text and never runs; states › edge: missing author shows a placeholder; states › edge: a filter with no matches says so |
| Book detail `/books/:id` | navigation › book link opens its detail page and back returns | n/a: a book always has a title; the empty variant is the 404 | n/a: same skeleton code path as the list, covered there | navigation › missing book: explains and links home | states › edge: detail page without an author shows a placeholder; navigation › deep link: /books/2 renders without visiting the list |
| About `/about` | navigation › nav: About and Books each highlight exactly themselves | n/a: static page, no data | n/a: static page, no data | n/a: static page, no data | n/a: static page, no data |

## Controls

Hover and pressed: n/a for every control — the demo has no hover or pressed styling (design choice).

| Control | Effect + request | Focus-visible | Disabled | Busy | Failure |
|---|---|---|---|---|---|
| Theme toggle (header) | theme-a11y › theme toggle relabels, persists across reload, and toggles back | theme-a11y › Tab walk: every control reachable, each with a visible focus ring | n/a: never disabled | n/a: synchronous | n/a: local only, no request |
| Nav links Books / About | navigation › nav: About and Books each highlight exactly themselves | theme-a11y › Tab walk: every control reachable, each with a visible focus ring | n/a: never disabled | n/a: client-side routing | n/a: no request |
| Filters disclosure + All / Unread / Read | interactions › filters: disclosure toggles and each filter narrows the list | theme-a11y › Tab walk: every control reachable, each with a visible focus ring | n/a: never disabled | n/a: synchronous | n/a: no request |
| Clear filter | interactions › filters: Clear filter returns to every book | theme-a11y › axe: list with filters open, light | n/a: never disabled | n/a: synchronous | n/a: no request |
| Book row link | navigation › book link opens its detail page and back returns | theme-a11y › Tab walk: every control reachable, each with a visible focus ring | n/a: never disabled | n/a: client-side routing | navigation › missing book: explains and links home |
| Mark read / Mark unread | interactions › mark read / unread: sends the new state and relabels the button | theme-a11y › Tab walk: every control reachable, each with a visible focus ring | interactions › mark read: the button locks while its request is in flight | interactions › mark read: the button locks while its request is in flight | interactions › mark read failure: error shows and the button unlocks; states › edge: a non-JSON error (proxy 502) still explains itself |
| Add book form (Title, Author, Add book) | interactions › add: sends title and author, shows busy, then the new row | theme-a11y › Tab walk: every control reachable, each with a visible focus ring | interactions › add: sends title and author, shows busy, then the new row | interactions › add: sends title and author, shows busy, then the new row | interactions › add: empty title is blocked before any request; interactions › add: server rejection shows its message and unlocks the form |
| Add your first book | states › empty: first-run prompt focuses the title field | n/a: only rendered in the empty state; same button styles as the Tab-walked ones | n/a: never disabled | n/a: synchronous | n/a: no request |
| Try again | states › error: failure explains itself and Try again recovers | n/a: only rendered in the error state; same button styles as the Tab-walked ones | n/a: never disabled | states › loading: slow response shows a skeleton, then the list | states › error: failure explains itself and Try again recovers |
| Delete → dialog Cancel / Delete book | navigation › delete: dialog opens, Cancel keeps the book, Delete removes it | theme-a11y › axe: detail page with the dialog open, light | n/a: never disabled | n/a: no busy indicator; the dialog closes on success | n/a: demo does not handle delete failure — known gap, see README |
| ← All books / Back to books | navigation › book link opens its detail page and back returns; navigation › missing book: explains and links home | theme-a11y › axe: detail page with the dialog open, dark | n/a: never disabled | n/a: client-side routing | n/a: no request |
| Playwright docs (external) | navigation › about: external link opens a new tab safely | theme-a11y › axe: about page | n/a: never disabled | n/a: plain link | n/a: no request |

## Cross-cutting

| Concern | Test |
|---|---|
| Default theme (both OS settings) | theme-a11y › default theme is light whatever the OS prefers |
| Theme toggle persists | theme-a11y › theme toggle relabels, persists across reload, and toggles back |
| axe: each theme, each screen, expanded | theme-a11y › axe: list with filters open, light; theme-a11y › axe: list with filters open, dark; theme-a11y › axe: detail page with the dialog open, light; theme-a11y › axe: detail page with the dialog open, dark; theme-a11y › axe: about page |
| Keyboard: every control reachable, visible focus | theme-a11y › Tab walk: every control reachable, each with a visible focus ring |
| Reduced motion | n/a: the demo has no animation or smooth scrolling |
| Small screen: no sideways scroll | states › edge: long title truncates and the page never scrolls sideways |
| Visual baselines: theme × viewport | n/a: omitted from the demo so it runs identically on any OS (baselines are per-OS) |
