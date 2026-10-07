# 测试约定

项目以 PC Chromium 浏览器为目标。类型检查、构建、单元测试、隔离浏览器测试和 Supabase Local 集成测试是不同证据；不能把某一层的通过描述为其他层已验证。

## 常用入口

- `pnpm typecheck`：检查 Vue/TypeScript、共享 Zod 合同与三个 Deno Edge Function 入口。
- `pnpm lint`：检查 Vue、TypeScript、共享合同、仓库脚本与 Deno Edge Functions。
- `pnpm check:routes`：核对 RouteKey 合同、页面注册、唯一默认路径、有效权限键及导入文件存在且不被 Git 忽略；CI 还要求导入文件已跟踪。
- `pnpm check:docs`：核对活动 Markdown 的本地链接与 workspace 脚本引用；历史工作流记录不作为当前命令源。
- `pnpm build`：生成生产前端包。
- `pnpm test:unit`：运行 Node Vitest、独立 jsdom Vue 组件测试、共享合同和本地脚本测试。
- `pnpm test:components`：只运行 `*.component.test.ts`；Node 测试使用原 Vitest 配置。
- `pnpm test:e2e:mock`：用隔离响应启动 Vite 与 PC Chromium，验证路由、主要页面、授权 UI、延迟 Session 刷新/退出竞态，以及另一标签切换账号或同账号创建新 Session 时保留新 Session；诊断写入 `frontend/test-results/mock/` 和 `frontend/playwright-report/mock/`。
- `pnpm test:visual`：在固定 Linux amd64 Playwright 1.63.0 Noble 容器中比较登录页与 Dashboard 四个截图基线，产物位于 `visual/` 子目录；需要 Docker-compatible runtime。
- `pnpm test:visual:update`：在同一环境生成候选 PNG；审阅实际图和差异图后才入库，CI 不更新基线。
- `pnpm test:agent:start -- --scenario dashboard --browser <instance-id>`：先检查指定 BrowserSkill 实例、扩展与 debug 能力，再启动独立临时 Supabase 栈及动态 Vite 端口，并在该临时项目内运行受支持的 `setup:admin`。就绪检查用真实 `session-login` 管理员 Session 验证 Dashboard RPC、动态菜单和消息读模型；管理员 client 只准备 run 专属数据 fixture。
- `pnpm test:agent:fill -- --run-id <id> --session <session-id> --ref <snapshot-ref-or-css-selector> --field loginName|password`：仅允许所属 BrowserSkill Session，从私有运行文件读取本次临时管理员字段并执行一次表单填充；语义控件不可观察时允许使用已核实的页面 CSS selector；字段值不写入报告。
- `pnpm test:agent:cleanup -- --run-id <id> [--browser-page-visited true] [--product-status Pass|Fail|Unknown] [--reason <text>]`：页面实际访问后保存截图；再停止并导出调试记录、停止本次 BrowserSkill Session及清理临时栈。已确认的 `Fail` 不被后续中断覆盖；产品状态、资源清理状态、证据完整性独立记录，必要证据缺失会把 `Pass` 降为 `Unknown`。栈停止失败时保留项目目录并在报告中列出恢复路径。
- `pnpm test:e2e:local`：连接本机 Supabase/Mailpit，由真实 PC Chromium 验证恢复、登录、字典 CRUD、Realtime 收件、刷新恢复、COMMON_USER 越权拒绝、登出与旧 token 的 RLS 拒绝；诊断写入 `frontend/test-results/local-auth/` 和 `frontend/playwright-report/local-auth/`。
- `pnpm test:db`：在已启动的当前 Supabase Local 数据库运行 pgTAP，并创建/清理 Auth、RLS、Storage、Realtime 与 Edge 集成数据；它不会重建数据库。
- `pnpm check:migrations`：复制 Supabase 配置到临时目录，用唯一 project ID 和动态端口从空库重放 migrations/seed、二次执行 seed、运行 DB lint/advisors、pgTAP、Edge/Storage/Auth 检查、管理员 bootstrap 并发测试和本地 Auth 浏览器流程。脚本结束时只停止并删除自己创建的临时 Supabase 项目。
- `pnpm check:migration-upgrades`：在隔离数据库由历史流生成最近三条真实增量前的临时基线，并分别对历史库和临时基线库保留测试数据、应用同一组增量、验证数据/授权/ledger；另验固定发布基线。最终比较 RLS/ACL、函数安全属性、Storage、Realtime、seed 和完整 schema。探针不进 migration ledger，比较前清理；升级阶段不调用 `db reset`。

PC 浏览器最低验收路径固定为“登录 → 动态菜单 → 授权访问/拒绝越权 → 真实核心 CRUD → Realtime 收件 → 刷新恢复 → 登出并验证服务端拒绝旧 access token”。该路径由本地 Supabase 的 `test:e2e:local` 覆盖；mock E2E 和分层 pgTAP 测试不能替代该门槛。

## 安全与清理

- 本地测试不得连接远程 Supabase，不得输出 service-role/secret key。浏览器测试只使用 publishable key。
- `pnpm test:db` 会写入当前本地数据库的合成 fixture 并在结束时清理；开始前核对 Supabase Local project/端口归属和状态。
- `pnpm check:migrations` 会启动并销毁临时容器与数据卷，保留当前开发栈不变。失败时确认错误输出中的 project ID 和清理结果；不得停止无关容器。
- Agent 试点栈有独立 project ID 和系统临时目录；不要用 `pnpm supabase:stop` 清理它。使用对应 run ID 调用专属 cleanup，只有报告中的 cleanup 成功后才认为资源已回收。
- 测试生成的用户、Profile、消息、对象、邮件和进程必须清理。不得把真实业务数据写入 `supabase/seed.sql`。
- 行为、路由或 Supabase 权限改变时更新相应 Vitest/pgTAP/Playwright 验证；全套跑完后继续改代码，必须重跑受影响检查。

## 结果描述

明确记录命令、退出码和运行范围。指出跳过或未覆盖的场景；类型检查与构建不代表 Auth、RLS 或浏览器链路通过，mock E2E 也不代表真实网络集成已通过。

Dashboard Smoke 只在对应组件、Service 与视觉自动化通过，并且指定 BrowserSkill 实例完成真实验收后删除；Agent 报告必须同时满足 `productStatus=Pass`、`cleanupStatus=Succeeded`、`evidenceStatus=Complete`。断言未映射、必要证据缺失或任一状态为 `Unknown`/`Failed` 时保留旧测试；本试点只删除 Dashboard 已承接的 Smoke。覆盖分层与本次验收证据见 [ADR 0002](../docs/adr/0002-dashboard-test-coverage-strategy.md)。

Playwright 的 Mock、Local Auth、Visual 诊断分别保存在 `test-results/{mock,local-auth,visual}/` 和 `playwright-report/{mock,local-auth,visual}/`。CI 在所有相关检查完成后上传父目录，不能让某一套 Playwright 启动时清除另一套的报告。
