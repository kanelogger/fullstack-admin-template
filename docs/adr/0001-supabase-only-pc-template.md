# 0001. 使用 Supabase 的 PC 浏览器管理后台模板

- 日期：2026-10-05
- 状态：生效
- 背景：模板原有 Vue 管理后台仍依赖 Fastify/MySQL，并在阶段迁移 Supabase、Zod 和 shadcn-vue。维护者要求完整落实 `docs/diagram/architecture.md`，并限定 PC 浏览器端。
- 决策：
  - 前端使用 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse、TypeScript、Vite、pnpm；服务端平台统一使用 Supabase。
  - 根 pnpm workspace 包含前端与共享 `@template/contracts`；Zod schema 由前端与 Deno Edge Functions 共用。
  - Auth Session 由 Supabase Auth 持久化；Permission Store 内存持有角色码和权限键；DB/RPC/Edge 的 RLS 与服务端授权是安全边界。
  - Auth 临时网络/5xx 错误保留已验证的当前 UI 身份；明确 Auth 4xx 拒绝 Session 时清理身份、权限与受保护路由。
  - 动态菜单路由通过固定 RouteKey 映射既有权限键，不维护重复的 role-menu 关系；Dashboard 待办就是本人未读消息。
  - 面向全新模板，不支持历史 MySQL 数据迁移器；保留已应用 migration 账本，并用追加 migration 撤销 importer RPC/helper。
  - 只验证 PC Chromium，不把移动浏览器布局、测试或生产部署列入范围。
- 备选方案与否决原因：保留 Fastify/MySQL 双运行时会要求模板用户维护两套依赖、部署和权限边界；保留导入器会把一次性旧数据迁移复杂度带入新项目；另建任务实体和 role-menu 表会复制已有消息待办与权限键关系，均不符合目标模板范围。
- 证据：根 pnpm 冻结安装、全栈类型检查、生产构建、25 项前端 Vitest、21 项共享合同 Vitest 和 2 项本地 helper 测试通过；PC mock Chromium 19 项通过、1 项真实 Auth 测试按 mock 命令配置跳过。最终 `pnpm check:migrations` 在独立临时 Supabase 项目 `template-migration-3ce7273ef9` 通过：24 个 migration 从空库重放，重复 seed、DB lint/advisors、8 个 pgTAP 文件共 333 项以及 Auth、Edge、Storage 集成都通过。真实 PC 浏览器链路验证 Mailpit 恢复、密码重设与登录、RLS 菜单展开并点击授权 CRUD 页面、字典增改删、Realtime 收件、刷新恢复、越权拒绝、登出及旧 access token 被 Profile RLS 拒绝。GitHub Actions、根 workspace 和 migration 文件目前在工作区但未暂存或提交；远程 CI job 尚未运行。

## 最终架构审阅与修正

- 审阅意见中的登出撤销缺少确认、自定义菜单 path 刷新落 404、完整 PC 浏览器验收门槛被削弱、密码重置页越过 Auth feature service 四项均成立，适合修复。
- 登出保留即时清空应用内身份的体验，同时等待有 5 秒上限的服务端撤销 RPC 并校验 `true`；网络失败或超时仍清除本地 Supabase Session，并明确提示服务端撤销未确认。真实浏览器在登出前后用同一旧 access token 读取受 RLS 保护的 Profile，确认旧 token 不再可读。
- 已登录的未知 URL 先恢复 RLS 过滤的动态菜单，再按已授权的 RouteKey 自定义 path 重新解析；无 Session 的未知 URL仍保持公开 404。PC E2E 直接打开并刷新自定义菜单 path，验证不会被 catch-all 提前截断。
- 恢复真实浏览器最低验收门槛，并把本地 Auth 浏览器流串成一条链：密码恢复/登录、展开服务端动态菜单并点击受保护字典页、真实 CRUD、Realtime 消息收件、刷新恢复、越权拒绝、登出和旧 token 的 RLS 拒绝。mock UI 与 pgTAP 继续补充覆盖，不能代替这条真实链路。
- 密码恢复 token/session 处理已收口在 Auth feature service，页面只调用 feature API。未暂存/未提交的文件是当前工作区交付状态，不是实现缺陷；未自动 stage/commit 符合仓库规则。远程 CI 尚无执行证据。

## 跨标签登出与账号切换回归

- 新复查意见成立。原流程在标签 A 等待账号 A 的撤销 RPC 时，标签 B 退出 A 会向 A 广播 `SIGNED_OUT` 并清除待处理标记；之后 B 登录账号 B 的 `SIGNED_IN` 被 A 当作无需恢复，A 仍留在登录页。
- `SIGNED_IN` 携带与当前应用身份不同的账号，且应用 Session 已初始化时，在 Auth 回调外刷新 Profile 与动态导航；刷新期间用户已恢复该身份则跳过重复请求。若应用因此从登录页恢复已认证身份，初始化菜单后进入该账号的第一个授权路由。
- 新 PC 浏览器回归在共享 Chromium 上下文运行：A 标签阻塞撤销响应，B 标签实际退出 A 并登录 B；确认 A 标签在旧撤销完成前恢复 B，释放旧响应后 B 的界面与持久 Auth Session 仍在。`pnpm test:e2e:mock` 20 项通过，1 项真实 Auth 用例按配置跳过；全量类型检查、单测与构建通过。
