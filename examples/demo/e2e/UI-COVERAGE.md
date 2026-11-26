# UI coverage — PASS

Generated 2026-11-26T13:41:04.011Z by `node tools/ui-gate.mjs --runs=3`.

| Check | Result | Detail |
|---|---|---|
| Spec lint | ✅ | 0 errors, 0 warnings in 4 files |
| Inventory crawl | ✅ | done |
| Suite green ×3 | ✅ | 3/3 runs green |
| JS function coverage | ✅ | 100.0% (min 90%) |
| UI element coverage | ✅ | 23/23 interacted, 100.0% (min 100%) |
| State matrix | ✅ | 82 cells, 0 problems |

## Spec lint

```
Spec lint: 4 spec files, 0 errors, 0 warnings
```

## UI elements and state matrix

```
UI coverage: inventory of 19 elements on 3 routes, 35 test runs

✅ *  4/4 (100.0%)

✅ /  13/13 (100.0%)

✅ /about  1/1 (100.0%)

✅ /books/:id  5/5 (100.0%)

State matrix: 82 cells, 0 problems

✅ UI elements interacted: 23/23 (100.0%), min 100%
```

## JS coverage

```
JS coverage from 35 test runs, 1 app scripts

✅ /app.js
   functions: 33/33 (100.0%)
   code:      100.0% of non-comment characters executed

✅ total: functions 33/33 (100.0%), code 100.0%, min 90%
Each uncovered item: write the test, or note why it can't happen.
```
