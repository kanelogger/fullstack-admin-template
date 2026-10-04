# Supabase 架构迁移与本机开发环境

- 状态：进行中
- 目标：按 `docs/diagram/architecture.md` 将前端逐步迁到 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse、Zod 和 Supabase；每个业务切片通过验收前保留 Fastify/MySQL。
- 已确认决策：保留 BIGINT 业务 ID 并增加 Supabase Auth UUID 映射；应用唯一登录入口为 `login_name` + 密码，邮箱仅用于强制/自助密码重置，不迁移 MD5；应用不提供 OTP/魔法链接、短信、OAuth、SSO 或 Passkey 登录；契约从 `frontend/src/contracts` 开始；SUPER_ADMIN 全权、OPERATOR 在授权模块读数据且写操作按权限键控制、普通用户只能访问本人资料和消息；普通用户增加消息中心；先按个人资料、消息、用户、角色、菜单、组织、字典/配置、附件/日志、仪表盘迁移。
- 本轮已完成：添加 Volta、pyenv、Conda、yrm、OrbStack 项目环境配置/说明；锁定 Supabase CLI 2.119.0、Supabase JS、Zod、Vitest、Playwright；建立 Supabase Local Auth/权限 migration、Edge 登录/重置、Fastify 一次性旧 JWT bridge、前端 Supabase Session client 与 Profile/消息/用户服务及页面。**唯一应用登录方式为 `login_name + 密码`**；邮箱仅用于密码恢复。全局与 email provider 公共注册关闭，不提供 OTP/魔法链接、短信、OAuth、SSO 或 Passkey 登录。RLS 和 bridge 校验 `amr=password` 与服务端登记的 Session，登出会撤销登记；强制重置校验密码哈希快照。
- 本轮补充完成：角色页与菜单管理页切到 Supabase；增加 `admin_role_catalog`、`save_admin_role`、`replace_role_permissions`、`delete_admin_role` 和固定 RouteKey 菜单表/RLS/RPC；菜单读模型为 security-invoker，写操作按权限键校验。应用壳的侧栏、顶栏、面包屑、多标签、搜索和通知改用 shadcn-vue/Tailwind。登录后的动态路由已由 Supabase `current_navigation()` 接管，页面组件按固定 RouteKey registry 加载；Fastify `async-routes` 仅作为旧接口保留。
- 附件切片完成（2026-10-02）：附件页切到 shadcn-vue 与 feature service；建立 private `admin-attachments` bucket、元数据 read model、分离的 read/upload/delete 权限、Session/RLS 策略和 Service Role 专用历史导入 RPC。新增安全导入器，默认只读预览，只能 apply 到本地 Supabase；当前专用测试库预览为 0 条附件。真实 local Storage 测试通过 SUPER_ADMIN 上传/删、OPERATOR 有权限读取但写操作被拒、COMMON_USER 无法读取；历史导入保留 BIGINT 文本、独立可空的业务模块/记录字段并验证幂等。附件 Playwright smoke、契约单测和 7 项导入映射测试通过。
- 审计与仪表盘切片完成（2026-10-02）：三类日志页面切到 `audit.*_log_read_model` 并复用 shadcn audit page；审计读取由 RLS 和 `audit.logs.read` 控制。Supabase 记录登录成功/失败、注册密码 Session 的表变更和 user-management Edge 操作；操作参数只记最小目标 ID，异常日志 writer 限于 service_role。历史 MySQL 日志导入器默认只读，敏感参数/文本脱敏，未映射旧 actor ID 置空并保留快照；专用测试库只读预览为 0 行。仪表盘切到 `dashboard_overview()`，消息/近期活动限本人或授权范围，用户/角色/菜单/审计指标逐项检查权限；OPERATOR 无审计读取权时只见本人近期操作，普通用户不获 dashboard RPC 权限。
- 账号密码入口复核（2026-10-02）：登录页仅提供 `login_name` + 密码表单；邮件只用于忘记密码恢复。扩展 Playwright 登录 smoke，断言没有邮箱、手机、OTP、额外登录链接或第三方登录控件；定向用例通过。Supabase 底层 recovery OTP 不创建可访问业务数据的应用 Session。
- 本机证据（2026-10-02）：Volta 2.0.2、Node 24.18.0、npm 12.0.2、pnpm 12.3.4、yrm 1.0.6、pyenv 2.8.4、Conda 24.4.0、Docker CLI 29.4.0、OrbStack 2.2.3。受限沙箱无法访问 Docker socket；通过授权的只读检查确认本地 Supabase 可访问，并完成本轮增量 migration 与 lint/advisor。
- 本机验证证据（2026-10-02）：使用已确认的 `fullstack_admin_template_test` 专用本机 MySQL 源库、时区 `+08:00`，只读预检通过；Supabase Local 有 3 个合成账号、4 条消息、2 个部门、4 个岗位、3 个字典类型、9 个字典项和 6 条系统配置。导入不迁移 MySQL 密码哈希，真实账号/邮箱所有权没有验证；没有导入 MySQL 菜单授权、没有链接远程 Supabase，也没有运行会删表的 MySQL Schema/Seed。
- 验证结果（2026-10-02）：附件、审计、Dashboard 改动后前端类型检查通过；Vitest 12 个文件/46 项通过；生产构建通过；完整 Playwright 16 项中 15 项通过，1 项本地 Auth spec 按配置跳过，另有真实 Mailpit Auth browser flow 通过。针对性审计/dashboard 页面 smoke 也通过。`pnpm test:db` 的 413 项 pgTAP + Edge/Auth + Storage + audit/dashboard RLS/写入通过，临时账号、对象、元数据、审计日志和邮件已清理；migration lint 与 advisors 无错误/警告。附件和三类旧日志只读预览均为 0 行，导入逻辑由离线映射和数据库幂等测试覆盖。完整空库重放仍待在独立 disposable Supabase 栈上验证。
- 验收边界与下一步：账号密码是唯一登录方式，邮件只用于重置；附件和日志源数据为空，没有执行历史数据 apply。三类审计页不显示迁移期间外部旧 Fastify 客户端新写入的 MySQL 日志；这些兼容写入在旧链路退出前仍留在 MySQL。Dashboard browser E2E 使用隔离响应 fixture，RPC 权限由本地 pgTAP 覆盖。下一步审计并迁移剩余 Element Plus/PureAdmin/shared component 与旧 API 引用，再验证慢刷新退出/切换账号和独立空库重放，按验收结果退出 Fastify/MySQL bridge。

## 最新复验（2026-10-02）

- 审计与仪表盘切片后，前端类型检查通过，Vitest 12 个文件/46 项通过，生产构建通过；全套 Playwright 16 项中 15 项通过、1 项本地 Auth spec 按配置跳过；另行运行的真实 Mailpit Auth browser test 通过。
- 最新 `pnpm test:db`：11 个 SQL 测试文件、413 项 pgTAP 全通过；Edge Auth、用户管理审计、登录成功/失败审计、私有 Storage 权限、历史附件/日志导入幂等和 dashboard 角色范围检查通过。临时用户、附件对象/元数据、登录/操作审计日志和邮件清理完成。`db lint --local` 与 `db advisors --local --type all --level warn` 均无错误/警告。
- 专用本地 MySQL 源库三类日志只读预览均为 0 行，附件预览也是 0 行；未执行空数据 apply。独立空库 migration/seed 重放仍待验证。
- 整体目标仍进行中：审计残余 Element Plus/PureAdmin/shared components 和 Fastify/MySQL API 调用；验证慢 Token 刷新期间退出/切换账号；在独立 disposable Supabase 栈上从空库重放。外部旧 Fastify 客户端新增的 MySQL 日志在兼容链路退出前不会出现在 Supabase 审计页。

## 2026-10-03 阶段性收口记录

- 本轮范围：收口前端 Auth/依赖/Playwright mock Session 改动；完成前端类型检查、构建和登录页启动核对后停止。本记录不代表真实鉴权或整个架构迁移验收完成。
- 已验证：前端 Auth 登录服务不再交换 Fastify JWT；用户 Store 和路由守卫使用 Supabase Session；旧前端 API/HTTP/Cookie Token 文件已删除；Vite `/api` 代理和 `VITE_API_BASE_URL` 已移除；登录页只提供账号密码，邮箱只用于密码重置；已认证的 Playwright UI mock 使用 Supabase Session 夹具。
- 已验证命令：`./node_modules/.bin/tsc --noEmit` 通过；`./node_modules/.bin/vue-tsc --noEmit --skipLibCheck` 通过；`./node_modules/.bin/vite build` 通过（有 Zod 注释和 Supabase 静态/动态导入混用警告）；`./node_modules/.bin/playwright test --list` 成功列出 16 项测试、未执行测试；`git diff --check` 通过。
- 浏览器核对：本地 Vite 启动成功，登录页标题为“登录 | Admin”，账号/密码表单可见。浏览器 Performance resource 中 `/api` 请求数为 0。开发服务启动时需解除 sandbox 对 `127.0.0.1:8848` 的 `listen EPERM` 限制；服务在核对后已停止。
- 未验证/阻塞：真实 Supabase 登录、刷新/退出竞态、动态菜单和权限跳转、个人资料真实读写均未在本轮运行；`pnpm typecheck` 在 supply-chain policy 元数据核验阶段未进入 TypeScript 检查，直接 `tsc` 与 `vue-tsc` 等价命令已通过。离线锁文件验证报 `ERR_PNPM_NO_OFFLINE_META`（缺少 `@lucide/vue` registry 元数据），因此本轮未证明干净安装。空库重放未执行：独立栈尝试因 Docker socket 返回 `permission denied` 停止，没有碰当前 Supabase 栈。
- 后续待办：真实账号密码登录与刷新竞态；三类角色及核心 CRUD；独立 Supabase 空库重放；旧后端退出和 Fastify/MySQL 清理。
- 阶段结论：本轮代码收口与静态/启动检查通过；**真实业务验收和独立安装尚未完成，整体迁移继续进行**。本次停止后不自动启动下一阶段。
