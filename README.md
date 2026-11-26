# ui-testing

一个 Claude Code skill：用 Playwright 在真实浏览器里测 Web UI，并且**证明**测到了哪些、漏了哪些。

专门针对 vibe coding 的老问题：AI 写完页面、再让 AI 写测试，结果是一堆能通过的 happy path，
没人说得清到底覆盖了多少 UI——因为“全部 UI 有哪些”这张清单，本身也是同一个 AI 凭印象写的。

这个 skill 让覆盖率对照**测试自己没法挑选的分母**来算：

| 问题 | 分母（不由测试决定） | 工具 |
|---|---|---|
| 每个控件都被操作过吗？ | 爬虫在每个路由上找到的全部可交互元素 ∪ 任何测试在屏幕上见过的元素 | `ui-coverage.mjs` |
| 每个状态都到达过吗？ | 状态矩阵（从机器生成的草稿起步）；每格必须指向一个**真实存在且通过**的测试 | `ui-coverage.mjs` |
| 每条代码路径都跑过吗？ | 应用自身脚本里的每个函数（V8 覆盖率） | `coverage-report.mjs` |
| 测试真的在检查东西吗？ | 每个测试的函数体（空断言、没 await、`toBeTruthy()` 判 Locator…） | `lint-specs.mjs` |

一条命令 `node tools/ui-gate.mjs` 跑完全部，输出 `UI-COVERAGE.md`，全部通过才返回 0。

## 实测：同一个 demo 应用，两套测试

`examples/demo` 是一个小型阅读清单 SPA（列表、详情页、确认对话框、筛选面板、空/错误状态、主题切换）。

| | 典型 AI 测试（3 个） | 按本 skill 写的测试（36 个） |
|---|---|---|
| Playwright 结果 | ✅ 全绿 | ✅ 连续 3 次全绿 |
| 空心测试检查 | ❌ 2 处（`expect(locator).toBeTruthy()`、没 await 的 `toHaveCount`） | ✅ 0 |
| UI 元素被操作 | ❌ 3/19（15.8%） | ✅ 23/23（100%） |
| JS 函数覆盖 | ❌ 53.1% | ✅ 100% |
| 状态矩阵 | ❌ 56 处缺口 | ✅ 82 格，全部指向通过的测试或写明原因的 `n/a` |

第一套测试“全绿”，但门禁直接列出了 16 个从没被碰过的控件，以及它们是怎么被发现的
（例如 `dialog "Delete this book?" | button "Delete book"`——爬虫点击“Delete”后才出现）。

写第二套测试的过程中，门禁和测试一共抓到 demo 里 **4 个真实的应用 bug**，全部是“手点一遍发现不了”的那类：

- 书名很长时整个页面被撑到 2036px 宽（flex 子元素缺 `min-width: 0`）
- 暗色主题下“← All books”链接对比度不达标（只在暗色主题、只在详情页）
- 筛选面板 `aria-expanded="false"` 但其实一直显示——`.filters { display: flex }` 覆盖了 `hidden` 属性
- “clear filter” 是带点击事件的 `<span>`，键盘和读屏用户用不了（UI 报告的“无角色可点击元素”警告）

完整报告见 [examples/demo/e2e/UI-COVERAGE.md](examples/demo/e2e/UI-COVERAGE.md)。

## 和原版的区别

本项目基于 [viviannnl/ui-testing](https://github.com/viviannnl/ui-testing)（MIT）。原版的七层测试方法、
fixtures、JS 覆盖率报告和 triage 规则都保留了下来；改动集中在“怎么证明覆盖完整”：

| | 原版 | 本版 |
|---|---|---|
| “全部 UI”清单 | 人/AI 手写状态矩阵 | 爬虫自动盘点 + 测试运行时实时补充；矩阵从 `--draft-matrix` 生成的草稿起步 |
| 控件级覆盖率 | 无（只有 JS 函数覆盖率） | 每个元素是否被点击/输入/键盘激活过，按路由列出未覆盖项和发现路径 |
| 矩阵可信度 | 格子里写什么都行 | 每个引用都对照 `.results.json` 校验：测试必须存在**且通过**；`n/a` 必须写原因 |
| 空心测试 | 靠规则文字提醒 | `lint-specs.mjs` 自动拦截 12 类问题（7 类报错、5 类警告） |
| 门禁 | 分散的几条命令 | `ui-gate.mjs`：lint → 爬取 → 连跑 N 次 → 覆盖率 → 矩阵 → `UI-COVERAGE.md` |
| 防“刷分” | — | `ignore` 规则和 `n/a` 必须有理由；未命中的 ignore 规则会被报出；skill 规定不得为过门禁降阈值或删矩阵行 |
| 可访问性 | axe + Tab 遍历 | 另外报告“有指针光标但没有语义角色”的可点击元素（React/Vue 里常见的 `div onClick`） |
| 平台 | bash 脚手架 | Node 脚手架，Windows / macOS / Linux 通用 |
| 示例 | 无 | `examples/demo`：可运行的应用 + 通过门禁的完整测试 |

## 安装

需要 Node 20+ 和 Google Chrome。

```powershell
git clone https://github.com/BeforeLanding/ui-testing.git
```

```powershell
New-Item -ItemType Junction -Path "$HOME\.claude\skills\ui-testing" -Target "$PWD\ui-testing\ui-testing"
```

macOS / Linux：

```bash
ln -s "$PWD/ui-testing/ui-testing" ~/.claude/skills/ui-testing
```

在 Claude Code 里说“给这个页面写 UI 测试 / 检查现有 UI 测试漏了什么”会自动触发，也可以直接 `/ui-testing`。

## 不通过 skill，单独使用

```powershell
node ui-testing/scripts/scaffold.mjs D:\path\to\your-project
```

会在项目里创建 `e2e/`（配置、fixtures、爬虫、探针、四个工具、矩阵模板）并安装依赖，不会覆盖已有文件。
按提示改好端口、启动命令和 mock 之后：

```powershell
cd D:\path\to\your-project\e2e; npm run gate
```

```powershell
npm run draft-matrix
```

```powershell
npm run gate:ship
```

依次是：爬取 + 运行 + 出报告；从盘点结果生成矩阵草稿；交付前连续 3 次全绿的最终门禁。

## 跑 demo

```powershell
cd examples/demo/e2e; npm install; node tools/ui-gate.mjs
```

## 局限（写在前面）

- **“操作过”不等于“验证过”**：指标证明测试操作了控件；操作后有没有检查效果，靠 skill 的规则和 lint（lint 只能抓整个测试没有断言的情况）。
- 爬虫只展开一层（点一次）；更深的 UI 要等测试走到才进入分母，多步流程需要在矩阵里显式写行。
- 不盘点 canvas/WebGL、拖放目标、仅 hover 出现的菜单、跨域 iframe。
- 元素靠“路由 | 区域 | 角色 + 可访问名称”识别；名称随数据变化的控件需要 `collections` 或 `data-testid`，详见 [coverage-model.md](ui-testing/references/coverage-model.md)。
- demo 没有包含视觉回归基线（基线按操作系统区分，放进仓库会让别的系统首跑失败）。

## 目录

```
ui-testing/                      ← skill 本体（软链接到 ~/.claude/skills/ui-testing）
├── SKILL.md                     ← 方法、工作流、规则
├── references/
│   ├── coverage-model.md        ← 元素如何识别、计数；100% 不代表什么
│   ├── layer-patterns.md        ← 各层可直接复制的测试写法
│   └── triage-examples.md       ← 真实失败案例：应用 bug 还是测试 bug
├── scripts/
│   ├── scaffold.mjs             ← 在项目里创建 e2e/
│   ├── ui-gate.mjs              ← 一条命令的门禁
│   ├── ui-coverage.mjs          ← UI 元素覆盖 + 矩阵校验 + 草稿生成
│   ├── coverage-report.mjs      ← JS 覆盖率
│   └── lint-specs.mjs           ← 空心测试检查
└── assets/
    ├── ui-probe.js              ← 注入页面的探针（爬虫和测试共用，保证命名一致）
    ├── inventory.crawl.ts       ← 爬虫（独立的 Playwright project）
    ├── fixtures.ts              ← 严格控制台、覆盖率采集、mockApi / mockJob
    ├── playwright.config.ts
    ├── ui-coverage.json         ← 阈值、爬取设置、collections、带理由的 ignore
    └── state-matrix.md
examples/demo/                   ← 可运行的示例应用 + 通过门禁的测试
```

## 许可

MIT。原版 skill © 2026 Vivian Li，见 [LICENSE](LICENSE)。
