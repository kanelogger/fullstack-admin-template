# 测试约定

项目以 PC Chromium 为目标。合同、Service、Store、组件、Supabase 集成、Playwright 和 BrowserSkill 提供不同证据；不能用其中一层的通过代替其他层。

## 分层与入口

- `pnpm test:unit`：Vitest、共享 Zod 合同和本地脚本测试。输入解析、BIGINT 字符串 ID、部门 parent ID 与完整层级路径、父级选择防循环、权限、CRUD 状态、错误处理、重试和异步状态归属放在相应 Service/Store/组件测试中。
- `pnpm test:components`：只运行 `*.component.test.ts` 的 jsdom Vue 组件测试；根 `test:unit` 已包含该层。
- `pnpm test:db`、`pnpm check:migrations`、`pnpm check:migration-upgrades`：验证当前本地或独立临时 Supabase 中的 Auth、Edge、RPC、RLS、Storage、Realtime、部门层级外键/循环/软删除、pgTAP 与 migration 兼容性；不可重置远程或用户已有业务库。
- `pnpm test:browser`：Playwright Chromium 白名单，只运行 Session 竞态、权限导航、Local Auth、首位管理员登录和全路由布局矩阵。报告位于 `frontend/test-results/browser/` 与 `frontend/playwright-report/browser/`。
- `pnpm test:browser:local`：真实本地 Supabase/Mailpit 浏览器链路，覆盖恢复、登录、字典 CRUD、Realtime、刷新、越权拒绝、退出与旧 token 的 RLS 拒绝。报告位于 `frontend/test-results/browser-local/` 与 `frontend/playwright-report/browser-local/`。
- `pnpm test:visual`：固定 Linux amd64 Playwright 1.63.0 Noble 容器中的 14 个像素状态比较。状态为登录双主题、Dashboard 三布局双主题、用户表格双主题、Profile 表单双主题和角色授权弹窗双主题。未知请求必须失败；测试固定时间、字体来源、视口及 Zod 校验 fixture。

Playwright 只允许以下 spec：`session-race.spec.ts`、`navigation-authorization.spec.ts`、`auth-recovery-local.spec.ts`、`default-admin-login-local.spec.ts`、`visual-route-review.spec.ts`、`dashboard-visual.spec.ts`。正式基线 PNG 不参与源码摘要。

布局矩阵从 `registeredMenuRoutes` 读取 RouteKey、路径和权限，覆盖所有注册路由 × 垂直/横向/混合三布局 × 浅色/深色主题；检查页面标题、主题、布局、横向溢出、活动菜单可见性，以及横向和混合导航滚动。成功不逐页截图，失败保留截图、trace 和 report。

## BrowserSkill 报告

八个业务场景为 dashboard、messages-shell、organization、configuration、identity-navigation、attachments、audit 和 profile；checkpoint 与必需证据定义在 scripts/test-architecture-rules.json。通过 test:agent:verify 核对报告状态、证据文件、Session、origin、时间窗、产品输入和场景输入摘要。输入不匹配时须重新验收。

验收从固定源码副本运行，按冻结锁安装依赖，并核对运行前后的源码摘要与资源清理。运行摘要区分产品源码、场景执行配置和验收工具；普通 CI 不依赖历史 BrowserSkill 报告。

临时 Supabase project ID 不超过 40 个字符；浏览器操作经真实页面执行。CLI cleanup 导出 final.png 与 browser-debug.json；Harness 可传入 browser-session 并导入对应证据。

## 视觉基线候选

`pnpm test:visual:update` 在固定副本生成 14 个状态的候选 PNG、原图、差异图和独立 manifest；不修改正式 PNG。必须在实际审阅候选和差异后显式调用 `pnpm test:visual:accept -- --candidate <id>`。accept 校验当前视觉摘要和规则、候选完整性、正式基线原摘要及新增/删除登记，再原子更新 manifest 内目标；失败回滚全部文件。CI 只运行 `pnpm test:visual`，不生成或接受候选。Playwright browser、browser-local 与 visual 报告分开保存。

## 安全、清理与证据

- 不连接远程 Supabase；日志和报告不输出 service-role/secret key；浏览器只使用 publishable key。
- `pnpm test:db` 只写当前 Local 栈的合成 fixture 并清理。运行前核对 project/端口归属。
- 隔离迁移检查只停止并删除自身创建的容器和数据卷；不得停止无关容器或执行当前项目数据库 reset。
- BrowserSkill、migration 和 upgrade 验收栈使用唯一 project ID、临时端口和系统临时目录；Supabase CLI stop 成功后还须核对该精确 Docker project label 下容器、卷、网络均已消失。停止失败、资源查询失败或仍有资源时保留恢复目录和诊断信息。
- fixture 必须按 run ID 清理；test data 不写入 seed。Playwright 诊断不得互相覆盖。

## 报告结果

明确记录命令、退出码和覆盖范围。指出跳过、未覆盖、不可用或结论不明确的检查。不得把静态检查、构建或 Mock 浏览器结果描述成真实 Auth/RLS/Realtime 验收。
