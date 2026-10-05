# 当前架构与接口事实

- 最近核实：2026-10-05。静态事实以本文件、`package.json`、`supabase/config.toml`、SQL migrations、共享契约和验证脚本为准；实际行为以代码和测试证据为准。
- 目标用户界面：PC 浏览器；移动端适配与验收不属于模板目标。

## Workspace 与目录

- 根 pnpm workspace 包含 `frontend/` Vue SPA 与 `supabase/functions/_shared/contracts` 的 `@template/contracts` Zod workspace 包。根 `pnpm-lock.yaml` 锁定应用、Supabase CLI、Deno 和共享契约依赖。
- 前端主要目录：`src/app`、`src/layouts`、`src/router`、`src/stores`、`src/features`、`src/components`、`src/lib`。`features` 按业务域同时拥有页面、业务组件与 Supabase feature service；页面不直接发起 Supabase 查询。
- Pinia Store 分为 `session`、`permission`、`ui`、`tabs` 与 `notification`。Supabase Auth 管 Session 持久化；用户资料在 Session Store 内存态；角色码和权限键只在 Permission Store 内存态；标签和 UI 偏好与身份状态隔离。
- Supabase migrations/seed 位于仓库根 `supabase/`。Edge Functions 使用 Deno，`session-login`、`password-reset` 与 `user-management` 入口复用共享合同。

## Auth 与权限

- 唯一应用登录入口为 `login_name + 密码`。`session-login` Edge Function 在服务端映射已验证邮箱，建立 Auth Session 并登记允许访问业务数据的 Session。邮箱仅用于密码恢复；底层 recovery Session 不能读取业务数据。
- 首位管理员通过根命令 `pnpm setup:admin` 建立。仅限当前 Supabase Local；随机初始密码不输出，使用 Mailpit 密码重置链接完成设置。公共注册关闭。
- `profiles.auth_user_id` 必填并引用 `auth.users.id`；业务实体 ID 为 PostgreSQL BIGINT，在 Zod API 合同中以十进制字符串传输。
- RLS 是数据安全边界。`current_profile()` 返回本人资料、角色码和权限键；`current_navigation()` 按服务端授权返回菜单。浏览器只按固定 RouteKey registry 装载动态页面。路由守卫和按钮权限提供 UX 控制，不能替代 RLS/Edge/RPC 权限检查。
- 角色菜单授权复用菜单路由的既有 permission key，不创建第二套 role-menu 关系。按钮权限由角色权限集合及服务端授权函数管理。
- Auth 的 `SIGNED_IN`、`TOKEN_REFRESHED`、`USER_UPDATED` 在回调之后触发权限与导航刷新；焦点恢复和 60 秒轮询刷新会话。Session/权限使用操作版本检查，退出先确认服务端撤销应用 Session，再清本地 Auth Session；撤销失败时本机仍退出并提示服务端状态未确认。通知请求绑定 Profile 接收者和订阅版本。

## 数据功能

- 用户、角色、菜单、部门、岗位、字典、配置、Profile、消息、附件、审计与 Dashboard 均通过 Supabase RPC/表策略/Edge Functions。
- Dashboard 的待办是当前用户未读消息，不另建任务实体。消息的列表、详情、已读和 Realtime 事件受收件人 RLS 约束。
- 附件保存在私有 `admin-attachments` Storage bucket，元数据和对象权限分开控制；引用状态与 MIME/扩展名、大小受到数据库和 Storage 限制。
- 历史 MySQL 导入功能不属于新模板支持范围。已发布 migration 保持不可变；后续清理以追加 migration 删除 importer RPC/helper，并保留运行期仍依赖的 Postgres 兼容行为和 collation。

## 本地运行与质量入口

- Node `>=22.13.0`、pnpm `>=9`，项目固定 Node 24.18.0 / pnpm 12.3.4；Postgres Local major version 为 17。
- `pnpm supabase:start/status/stop` 管理本地栈；`pnpm dev` 同时启动 Edge Functions 与 Vite (`127.0.0.1:8848`)。Auth 邮件由本地 Mailpit 捕获。
- `pnpm typecheck` 检查前端、合同包和 Deno Edge Function；`pnpm test:unit` 跑 Vitest/helper；`pnpm test:e2e:mock` 覆盖 PC UI；`pnpm test:e2e:local` 覆盖本地 Supabase 完整 PC 浏览器链路：Auth、字典 CRUD、Realtime、刷新、越权拒绝和登出后 RLS 拒绝旧 token；`pnpm test:db` 跑当前本地 Supabase pgTAP 与服务集成；`pnpm check:migrations` 执行隔离空库重放、lint/advisors、数据库/服务测试和该真实浏览器流程。
- GitHub Actions 在 push/pull_request 上执行冻结安装、类型检查、构建、单测、PC mock 浏览器测试和隔离 migration check。无生产部署配置。
