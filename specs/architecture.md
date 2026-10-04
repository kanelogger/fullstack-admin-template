# 架构与接口事实

- 本文件记录当前仍然有效、且不能从单一文件一眼看全的契约性事实。实时实现细节以代码为准；本文件随实现核实更新，旧结论被取代时标明替代关系。最近核实：2026-10-02（对照前后端 package manifests、`supabase/config.toml`、Supabase migrations/seed、前端契约、测试入口）。

## 总体结构

- 单仓库两端：`frontend/`（Vue 3 SPA，端口 8848）+ `backend/`（Fastify API，端口 3000）。
- 开发链路：浏览器 → Vite dev server（8848）→ `/api` 代理（`frontend/vite.config.ts`，去掉 `/api` 前缀）→ Fastify（3000）→ MySQL。
- 生产链路未定义（无部署配置），发布相关事项需先与用户确认。

## 后端契约

- 全局鉴权：`app.ts` 注册 `onRequest` 钩子 `requireAuth`；仅 `WHITELIST`（停用密码登录的 `/login`、`/session/legacy-token`、`/refresh-token`、`/captcha`，见 `src/utils/jwt.ts`）免旧 JWT。
- 统一响应：成功 `{ success: true, data }`；失败 `{ success: false, error: { code, message, details? } }`（`src/utils/response.ts`）。业务错误抛 `AppError`（`src/utils/errors.ts`），由全局错误处理转换，未捕获异常会写入异常日志表并返回 500。
- 旧 API Token：由 bridge 用业务 BIGINT 用户 ID签发 access（分钟级）和 refresh（天级）JWT，payload `{ userId, username, type }`。Fastify `/login` 已返回拒绝，MD5 不再用于登录验证。
- 模块路由（均在 `app.ts` 注册）：auth、users、user-management、role-management、menu-management、org-management、dict-management、config-management、profile、attachments、messages、dashboard、logs、async-routes。Fastify `/messages` 暂留给旧客户端；当前前端消息中心已通过 Supabase feature service 访问 Postgres。
- 数据库：MySQL，库名默认 `admin_template`；表结构 `db/schema.sql`，初始数据（含默认账号与基础菜单）`db/seed.sql`。改表结构时两个文件需同步维护。

## Supabase 迁移基线（本地阶段）

- Supabase CLI 作为前端精确版本开发依赖固定；根目录 `supabase/config.toml` 定义本地 Postgres 17、Auth、Storage、Realtime、Edge Runtime、API 与邮件捕获端口。当前没有链接远程项目。
- `supabase/migrations/20261001000000_auth_and_permissions_foundation.sql` 建立 `profiles`、`roles`、权限目录与角色关联；`20261001122856_message_center.sql` 建立收件箱表、收件人 RLS、BIGINT 文本 read model、受限的消息导入 RPC 与 `supabase_realtime` publication；`20261002031505_role_menu_management.sql` 建立角色管理 RPC、固定 RouteKey 菜单表、RLS 与管理 RPC；`20261002032144_import_legacy_user_profiles.sql` 提供只允许 service_role 调用的账号映射导入 RPC；`20261002041100_role_delete_permissions.sql` 修正无用户分配角色的权限关联清理顺序；`20261002050000_menu_navigation.sql` 建立按当前注册密码 Session 和菜单权限过滤的 `current_navigation()` 及受限菜单导入 RPC；`20261002100329_dictionary_configuration_management.sql`、`20261002101613_organization_management.sql` 建立字典/配置及组织表、权限 RLS/RPC 和本地业务 API；`20261002110140_consolidate_menu_read_policy.sql` 合并重复的菜单读取策略；`20261002110254_index_referenced_audit_ids.sql` 索引会话撤销和审计关联外键；`20261002111836_legacy_dictionary_configuration_import.sql` 提供 service_role 专用的字典/配置导入 RPC；`20261002121302_attachments_storage_and_access.sql` 建立附件元数据表、私有 Storage bucket、按角色权限控制的读/写策略与元数据 RPC；`20261002125756_attachment_legacy_import.sql` 保留旧附件字段边界并提供仅 service_role 可调用的导入 RPC；`20261002134057_audit_logs_and_events.sql` 建立三类审计日志、读权限 RLS、账号密码登录 writer、已迁移表的安全变更触发器和 Edge 操作/异常 writer；`20261002135800_attachment_metadata_text_ids.sql` 修正附件创建 RPC 的 BIGINT 文本返回；`20261002141948_legacy_audit_log_import.sql` 提供三类 MySQL 审计日志的 service_role 专用幂等导入。组织、字典/配置、附件、审计日志均通过受控 importer 保留原 BIGINT ID 与业务值。业务 `profiles.id` 和 read model ID 均以十进制字符串传输，避免 JavaScript 数字精度丢失。`auth_user_id` 在真实账号映射前仍允许为空；本地 Supabase 的合成账号/数据导入不代表真实邮箱所有权，也没有远程数据导入。
- 权限键使用 `module.resource.action`。`SUPER_ADMIN` 通过受限的 `app_private.has_permission()` 拥有所有权限；普通用户只读本人资料并获得消息中心读取权限；OPERATOR 初始只有仪表盘、消息、附件的读取权限。消息表按现有 API 行为对所有角色限定为本人收件箱；写权限仅允许收件人更新 `read_status/read_at`。附件元数据按 `files.attachments.read` 控制列表与下载，Storage 上传与删除分别由 `files.attachments.upload/delete` 控制；上传者只能清理未登记的孤儿对象。
- 暴露 schema 为 `public` 与 `graphql_public`；授权判断函数放在未暴露的 `app_private`，固定 `search_path`，并只给已认证角色所需的函数权限。浏览器只接受 `VITE_SUPABASE_PUBLISHABLE_KEY`。
- 登录只提供 `login_name` + 密码：Edge Function `session-login` 在服务端把 login_name 映射到已验证邮箱并调用 Supabase Auth 密码验证，再把该 Auth Session 登记到私有白名单。浏览器不得直接调用 Auth 密码登录；RLS 与 Fastify legacy-token bridge 同时要求 JWT `amr=password` 和已登记的 Session。邮箱只用于 `password-reset`；本地 Auth 全局及 email provider 公共注册均关闭。底层 recovery OTP 仅用于重置，不能访问业务数据或换取旧 JWT。恢复流程还要求服务端创建重置请求且 Auth 密码哈希相对私有快照变化，完成后立即退出 Session。业务 Profile 的 `current_profile()` RPC 返回调用者自己的资料和权限，BIGINT ID 为十进制字符串。
- 前端登录与密码重置已接入 Supabase；随后调用 Fastify `/session/legacy-token`，由后端验证 Supabase Auth 用户并使用 `current_business_user_id()` 取得调用者自己的业务 ID，再签发临时旧 JWT。Fastify 只使用 Supabase publishable key，不持有 service-role key。专用测试库的本地集成脚本验证过账号密码 Edge 登录、旧 JWT bridge 和旧 Fastify 菜单 API；该旧 API 与应用当前导航分开。旧业务 API 暂时保留，无双写。桥接仍受旧 Fastify `number` ID 范围限制，账号预检须检查 `Number.MAX_SAFE_INTEGER`；Postgres BIGINT 也不能接收 MySQL unsigned BIGINT 超出 signed 范围的 ID。
- 个人资料页面已切到 Supabase，允许本人更新姓名与手机号；邮箱、登录名、角色由服务器/管理员管理。用户管理走受权限检查的 Edge Function，并通过组织目录选项维护部门/岗位关联；角色页通过 RPC 管理角色及权限；菜单页通过 RLS/invoker read model 和写操作 RPC 管理固定 RouteKey。部门、岗位、字典、系统配置和附件页面已切至 Supabase；三类日志页面使用 `audit.*_log_read_model`，底层 RLS 要求注册密码 Session 与 `audit.logs.read`。已迁移表的成功变更由触发器记录最小化参数；登录 Edge Function 记录成功/失败尝试，用户管理 Edge Function 记录变更与服务异常。旧 MySQL 审计历史通过只读预检和本地专用 importer 回填；未映射的旧用户 ID 转为空并保留名称快照，参数与文本中的凭据会脱敏。专用 MySQL 测试库三类日志预览为 0 行。Fastify 兼容客户端产生的后续日志仍留在 MySQL，当前 UI 的 Supabase 审计页不包含迁移期间外部旧客户端的新 MySQL 事件。仪表盘通过 `dashboard_overview()` RPC 读取当前用户消息与活动；用户、角色、菜单和审计统计分别检查相应读取权限，OPERATOR 无审计权限时只看本人近期操作。登录后的动态导航通过 Supabase `current_navigation()`，菜单 RLS 按角色权限返回可见路由；组件只由前端 RouteKey registry 解析。MySQL 菜单授权关系尚未导入。
- `auth_user_id` 的账号回填和唯一性预检已在专用合成测试库验证；不代表真实邮箱归属。Local Edge 与真实浏览器已通过邮件恢复、SPA 改密、账号密码登录和本人资料读取；Fastify/MySQL bridge 的本地 API 链路通过。刷新期间退出/切换账号的真实慢请求仍待验收。

## 前端契约

- 目标前端应用栈为 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse；构建使用 Vite 与 TypeScript。
- shadcn-vue 组件源码由本仓库维护，配置在 `frontend/components.json`，主题与 Tailwind 入口在 `frontend/src/style/tailwind.css`。侧栏、顶栏、面包屑、多标签、搜索、通知和已迁移页面使用 shadcn-vue；剩余旧页面仍依赖 Element Plus 及既有 PureAdmin 派生工具。
- 登录后从 Supabase `current_navigation()` 拉取 RLS 过滤的菜单树，再按固定 RouteKey registry 注册动态路由；按钮级权限用 `v-perms` / `v-auth` 指令。
- HTTP 统一封装在 `src/utils/http/index.ts`；业务代码不直接 import axios。
- 环境变量：`VITE_API_BASE_URL`（默认 `/api`）、`VITE_PORT`、`VITE_ROUTER_HISTORY` 等，见各 `.env*.example`。
- 新的 Zod 运行时契约集中在 `frontend/src/contracts/`，目前定义登录/重置、Profile/Session、消息、附件、审计日志、仪表盘、用户/角色/菜单、组织、字典/配置、Supabase 动态导航、BIGINT ID、权限键、RouteKey、分页和统一错误契约。
- Supabase JS、Zod、Vitest、Playwright 与精确版本 Supabase CLI 已加入前端依赖和 lockfile；认证、Profile、消息、附件、审计日志、仪表盘、用户/角色/菜单、组织、字典/配置已有 feature service。

## 测试与待接入链路

- `pnpm test:auth-bridge` 已通过本地账号密码登录、匿名拒绝、Fastify legacy-token bridge、有效旧 JWT 刷新和无效令牌拒绝；旧 MySQL 菜单 API 仍留给未迁移客户端。Realtime 测试等待真实订阅确认和复制就绪事件，不以 Broadcast replication slot 代替 Postgres Changes 准备状态。Realtime BIGINT payload 可能舍入，应用仅用它触发缓存失效，再从文本 read model 读取精确 ID。真实 Auth 浏览器恢复流程已通过；刷新期间退出/切换账号的真实慢请求仍待验收。
- 本地 Supabase 新增模块 migration、数据预检/导入和组织外键验证均已应用；源库 2 部门、4 岗位、3 字典类型、9 字典项、6 系统配置已按原 ID 导入并验证幂等。附件私有 Storage/RLS、旧元数据导入 RPC、实测上传/读取/拒绝/删除与幂等导入通过；登录与操作审计、Dashboard 权限 RPC、历史导入函数通过本地 pgTAP/Edge 验收。专用 MySQL 源库附件与三类审计日志只读预览均为 0 行。`test:db` 最新 413 项 pgTAP、Edge、审计、dashboard 权限、Storage/RLS、Realtime 和导入测试通过；`db lint --local` 无 schema errors，`db advisors --local --type all --level warn` 无警告。远程 Supabase 未连接，因此没有运行云端 Advisors。
- 当前没有 CI、MCP/外部连接或部署配置。

## Agent 工作环境

- 根级角色与导航由 `AGENTS.md` 提供；项目命令、写入范围和人工门禁由 `project.yml` 提供；环境事实按 `AI_ENVIRONMENT.md` 和 `docs/agent-environment/` 按需加载。
- `tasks/` 与 `workflow/` 保存可合并的过程记忆；阶段、锁、缓存和本地验证证据放在 `.agents/state/`，该目录被 `.gitignore` 排除。
- 发布配置、CI、MCP 或外部系统连接仍未定义；引入后必须同步登记相关命令、权限和验证入口。
