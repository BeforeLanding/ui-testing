# ui-testing

一个 Claude Code skill：用 Playwright 在真实浏览器里测 Web UI，并且**证明**测到了哪些、漏了哪些。

## 痛点

vibe coding 的常见流程是：AI 写页面 → 让 AI 补测试 → 测试全绿 → 一上手就发现按钮没反应、
空列表是白屏、暗色主题下文字看不清。

问题不在于测试写得少，而在于**没人能回答“还漏了什么”**：

1. **“全部 UI 有哪些”这张清单，是写测试的同一个 AI 凭印象列的。** 它想不到的控件和状态，
   既不在清单里，也不会被测，覆盖率永远“100%”。
2. **JS 覆盖率量的是代码，不是界面。** 一个从没被点过的按钮，它的渲染代码照样被执行了。
3. **全绿不等于检查过。** `expect(page.locator("h1")).toBeTruthy()` 永远成立；
   少写一个 `await` 的断言在测试结束前根本没执行。AI 写的测试里这两种都很常见。

## 思路：分母不能由测试自己定

要回答“漏了什么”，覆盖率必须对照**测试没法挑选的分母**来算：

| 问题 | 分母（不由测试决定） | 工具 |
|---|---|---|
| 每个控件都被操作过吗？ | 爬虫在每个路由上找到的全部可交互元素 ∪ 任何测试运行时在屏幕上见过的元素 | `ui-coverage.mjs` |
| 每个状态都到达过吗？ | 状态矩阵（从爬取结果生成的草稿起步）；每格必须指向一个**真实存在且通过**的测试 | `ui-coverage.mjs` |
| 每条代码路径都跑过吗？ | 应用自身脚本里的每个函数（V8 覆盖率） | `coverage-report.mjs` |
| 测试真的在检查东西吗？ | 每个测试的函数体 | `lint-specs.mjs` |

一条命令 `node tools/ui-gate.mjs` 跑完全部检查，生成 `UI-COVERAGE.md`，全部通过才返回 0。

## 怎么做到的

**1. 盘点：同一个探针，两种用法。** `ui-probe.js` 注入每个页面，给每个可交互元素一个稳定的名字：

```
/books/:id | dialog "Delete this book?" | button "Delete book"
   路由            区域                     角色 + 可访问名称
```

爬虫用它盘点：打开每个路由、跟随站内链接、在全新页面里逐个点击控件以展开菜单/对话框/标签页
（爬取期间所有非 GET 请求都被拦截，不会改数据）。测试 fixture 也用它：记录每个测试**见过**哪些元素、
**操作过**哪些元素。因为命名规则是同一份代码，两边的结果可以直接求差。

只在特定状态下出现的控件（错误页的“重试”、空列表的引导按钮）爬虫看不到，但测试把应用推到那个状态时，
探针会把它们自动加入分母——所以分母会随着测试变全而变大，而不是变小。

**2. 计数：什么算“测过”。** 点击、输入、选择、提交、在控件上按 Enter/空格/方向键算；
仅仅获得焦点（Tab 遍历）、悬停、滚动不算。数据渲染出来的列表行可以声明为 `collections`，
40 行书名链接算一个控件，而行内的“编辑”“删除”按钮仍各算一个。

**3. 状态：矩阵必须可验证。** `--draft-matrix` 从盘点结果生成矩阵草稿（每个控件一行），再补上空/加载/错误/边界等状态列。
门禁会对照最近一次运行的 `.results.json` 检查每一格：引用的测试必须存在且通过；写 `n/a` 必须附理由；空格就是缺口。

**4. 空心测试：静态拦截。** `lint-specs.mjs` 检查 12 类问题——7 类直接报错（没有断言、断言常量、
`toBeTruthy()` 判 Locator、没 await 的 web-first 断言、`force: true`、无理由的 skip、遗留的 `.only`），
5 类警告（固定 sleep、一次性读取代替重试断言、吞掉异常、按“屏幕上有没有”分支、过松的截图阈值）。

**5. 防刷分。** `ignore` 规则和 `n/a` 必须写理由，没命中任何元素的 ignore 规则会被报出；
skill 明确规定不得为了过门禁而降低阈值或删除矩阵行。

### 测试本身怎么写：七层

| # | 层 | 抓什么 |
|---|---|---|
| 1 | 确定性夹具：固定日期、真实 API 快照、按状态 mock 网络 | 让其余各层可重复、零成本 |
| 2 | 行为测试：每个交互一个测试，断言用户能看到的变化 | 坏掉的按钮、开关、导航 |
| 3 | 状态矩阵：每个区域的空/加载/错误/正常/边界，每个控件的禁用/忙碌/失败 | 没人实现或没人测的状态 |
| 4 | 视觉回归：主题 × 视口的截图基线 | 颜色、边框、间距这类回归 |
| 5 | 可访问性 + 键盘：axe WCAG AA 扫描 + Tab 遍历检查焦点环 | 对比度、标签、键盘够不着的控件 |
| 6 | 量化覆盖：上面的四个分母 | 没碰过的控件、状态、代码 |
| 7 | 严格控制台：任何 JS 报错都让测试失败 | 静默的运行时错误 |

失败时先判断**是应用错了还是测试错了**，再动手——把测试改成迎合 bug，是 bug 被藏起来的最常见方式。

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

写第二套测试的过程中，门禁和测试一共抓到 demo 里 **4 个真实的应用 bug**：

- 书名很长时整个页面被撑到 2036px 宽（flex 子元素缺 `min-width: 0`）
- 暗色主题下“← All books”链接对比度不达标（只在暗色主题、只在详情页）
- 筛选面板 `aria-expanded="false"` 但其实一直显示——`.filters { display: flex }` 覆盖了 `hidden` 属性
- “clear filter” 是带点击事件的 `<span>`，键盘和读屏用户用不了（UI 报告的“无角色可点击元素”警告）

完整报告见 [examples/demo/e2e/UI-COVERAGE.md](examples/demo/e2e/UI-COVERAGE.md)。

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

## 局限

- **“操作过”不等于“验证过”**：指标证明测试操作了控件；操作后有没有检查效果，靠 skill 的规则和 lint（lint 只能抓整个测试没有断言的情况）。
- 爬虫只展开一层（点一次）；更深的 UI 要等测试走到才进入分母，多步流程需要在矩阵里显式写行。
- 不盘点 canvas/WebGL、拖放目标、仅 hover 出现的菜单、跨域 iframe。
- 元素靠“路由 | 区域 | 角色 + 可访问名称”识别；名称随数据变化的控件需要 `collections` 或 `data-testid`，详见 [coverage-model.md](ui-testing/references/coverage-model.md)。
- demo 没有包含视觉回归基线（基线按操作系统区分，放进仓库会让别的系统首跑失败）。

## 目录

```
ui-testing/                      ← skill 本体（链接到 ~/.claude/skills/ui-testing）
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

MIT，见 [LICENSE](LICENSE)。fixtures、JS 覆盖率报告和部分测试写法改编自
[viviannnl/ui-testing](https://github.com/viviannnl/ui-testing)（MIT）。
