# 0010. 格式检查覆盖整个前端源码与路由元数据解析解耦

- 日期：2026-10-09
- 状态：生效
- 背景：
  - 评审指出 `pnpm format:check` 只覆盖 `frontend/src/features/**/*.vue`、`frontend/src/composables/**/*.ts` 和 `frontend/src/utils/message.ts`：`layouts/`、`components/*.vue`、`stores/`、`router/`、`main.ts` 以及 `features/**/*.ts`（service、store、hook）都不在检查范围内，其中包括本轮新写的 `frontend/src/components/ConfirmationDialog.vue`。
  - 实测把范围扩到 `frontend/src/**/*.{vue,ts}` 后有 83 个非 `components/ui/` 文件不符合格式；评审估算的 20 个只是 `layouts/` + `components/*.vue` 子集，真实缺口更大。
  - 扩大范围后立即暴露三处按行解析源码的耦合：`scripts/check-routes.mjs`、`frontend/e2e/visual-route-review.spec.ts`、`frontend/e2e/helpers/dashboard-visual-fixture.ts` 都用 `routeKey: "…"[^\n]*defaultPath: …` 这类正则解析 `menu-routes.registry.ts`。Prettier 换行后解析结果为 0 条，`pnpm check:routes` 与 `pnpm test:browser` 的布局矩阵真实失败。
- 决策：
  - 格式范围扩到 `frontend/src/**/*.{vue,ts}`，用新增的 `.prettierignore` 排除 CLI 生成的 `frontend/src/components/ui/`（registry 原格式）。Markdown 仍不进入格式化，设计文档保持只增补。
  - 保持 Prettier 默认 `htmlWhitespaceSensitivity: "css"`，不采用 `ignore`：Vue 模板存在依赖空白的行内排版，`ignore` 会把有意义的空格当无意义处理，风险高于可读性收益。
  - 把注册表解析抽到 `scripts/menu-route-metadata.mjs`（`parseMenuRouteRegistry` / `parseRegisteredMenuRoutes`），按条目而非按行解析，三个调用方共用同一实现；新增 `scripts/menu-route-metadata.test.mjs`，覆盖单行与多行格式得到同一结果、缺失声明/字段报错、真实注册表 15 条。
  - 格式化属于产品源码变化：八场景必须用新 run 重新验收，再刷新验证账本与具名 run ID 引用。
- 备选方案与否决原因：
  - 只格式化评审实测的 20 个文件：范围定义仍不完整，`stores/`、`router/`、`features/**/*.ts` 继续漏检。
  - 把 `menu-routes.registry.ts` 排除在格式化之外：保留脆弱的按行耦合，下次任何换行都会再次静默破坏检查与视觉 fixture。
  - 只修 `visual-route-review.spec.ts`：`check:routes` 和视觉 fixture 有同样缺陷，会留下三套不一致的解析实现。
  - 改用生成式 JSON 快照替代源码解析：更彻底，但要新增生成物与同步校验，超出本次范围；按条目解析已消除格式化耦合。
- 证据：
  - 格式化：83 个非 registry 文件按新范围重排，其中 74 个仅含格式化差异（+1165 / −810 行），另外 9 个同时带有本轮 shadcn 迁移改动。
  - 解耦前：`pnpm check:routes` 报 `Every RouteKey must have exactly one menu metadata entry`（实际为 `[]`）；`pnpm test:browser` 布局矩阵报 `The layout matrix requires at least one registered RouteKey`。解耦后两者均通过。
  - 本地回归：`format:check`、`lint`、`typecheck`、`build`、`check:docs`、`check:routes`、`git diff --check` 退出 0；`pnpm test:unit` 前端 78、组件 21、Edge HTTP 3、共享合同 21、Node 78（含 4 个新解析测试）通过；`pnpm test:browser` 14 项通过、2 项按配置跳过；固定 Linux `pnpm test:visual` 14 项通过（319 输入摘要），说明格式化未改变已覆盖页面状态的像素。
  - 八场景在格式化后源码上重跑（产品摘要 `20dd719e09790c30f94a264905dd4e00369fabc46c18275e142e74c194068148`、场景执行摘要 `4698c8d1c32ea3219a111f941fd9f7f23ba0a12d2ecb00543717c7b26fb9f07e`），34/34 checkpoint 为 `Pass`，统一 `pnpm test:agent:verify` 全集合返回 `valid: true`；`pnpm check:test-architecture` 返回 `valid: true`、`managementDrift` 为空：

| 场景 | BrowserSkill run ID | checkpoint |
| --- | --- | ---: |
| `dashboard` | `d0bcd327-b2e1-4848-8fb0-d8cc60a9f133` | 4/4 |
| `messages-shell` | `fa32a37e-d8c0-43b4-aaa6-f66d72d0ebdf` | 4/4 |
| `organization` | `88f3be60-e29d-4a54-8bc6-63053719f3bd` | 4/4 |
| `configuration` | `2902b3c3-acd4-4f9c-b769-9ec33a1bef6e` | 4/4 |
| `identity-navigation` | `43fb9fdc-741c-476e-9c4c-9199ef3f170f` | 7/7 |
| `attachments` | `91e08acb-5b3c-45be-8994-f7d2d102c174` | 4/4 |
| `audit` | `6ff9d4e4-63e0-4287-aaa9-6603a16016ac` | 4/4 |
| `profile` | `2dc88896-4183-4929-acf6-43b347746d7f` | 3/3 |

  - 格式化后的壳层与布局模板经真实场景复核：面包屑、标签、菜单搜索、动态导航、通知空态/重试、部门层级、菜单 RouteKey 白名单、附件上传/下载/删除均正常；附件上传仍走可见按钮触发的原生文件选择器（扩展文件网址权限已开启），下载字节 SHA-256 与上传文件一致。
  - 资源清理：八个 run 均 `cleanupStatus=Succeeded`、`retained*` 为 null；核验无 `agent-*` 容器、卷或网络残留，BrowserSkill session 列表为空，无遗留临时运行目录。
  - 交接文档 `docs/handoffs/20261009-architecture-review-handoff.md` 按仓库约定删除：任务进行中用 `tasks/`，结论归档 `docs/adr/`；该文档状态行已过时，且引用了个人路径与 `/private/tmp` 临时文件，`docs/handoffs/` 也不在约定目录内。
  - 仍未证明：远程 CI 无新提交证据。
