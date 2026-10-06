# 当前架构与接口事实

- 最近核实：2026-10-06。静态事实以本文件、`package.json`、`supabase/config.toml`、SQL migrations、共享契约和验证脚本为准；实际行为以代码和测试证据为准。
- 目标用户界面：PC 浏览器；移动端适配与验收不属于模板目标。

## Workspace 与目录

- 根 pnpm workspace 包含 `frontend/` Vue SPA 与 `supabase/functions/_shared/contracts` 的 `@template/contracts` Zod workspace 包。根 `pnpm-lock.yaml` 锁定应用、Supabase CLI、Deno 和共享契约依赖。
- 前端主要目录：`src/app`、`src/layouts`、`src/router`、`src/stores`、`src/features`、`src/components`、`src/lib`。`features` 按业务域同时拥有页面、业务组件与 Supabase feature service；页面不直接发起 Supabase 查询。
- Pinia Store 分为 `session`、`permission`、`ui`、`tabs` 与 `notification`。Supabase Auth 管 Session 持久化；用户资料在 Session Store 内存态；角色码和权限键只在 Permission Store 内存态；标签和 UI 偏好与身份状态隔离。
- Supabase migrations/seed 位于仓库根 `supabase/`。Edge Functions 使用 Deno，`session-login`、`password-reset` 与 `user-management` 入口复用共享合同。

## Auth 与权限

- 唯一应用登录入口为 `login_name + 密码`。`session-login` Edge Function 在服务端映射已验证邮箱，建立 Auth Session 并登记允许访问业务数据的 Session。邮箱仅用于密码恢复；底层 recovery Session 不能读取业务数据。
- 首位管理员通过根命令 `pnpm setup:admin` 建立。仅限当前 Supabase Local；模板默认登录账号为 `admin`、密码为 `admin123456`、邮箱为 `admin@example.test`。公共注册关闭。
- `profiles.auth_user_id` 必填并引用 `auth.users.id`；业务实体 ID 为 PostgreSQL BIGINT，在 Zod API 合同中以十进制字符串传输。
- RLS 是数据安全边界。`current_profile()` 返回本人资料、角色码和权限键；`current_navigation()` 按服务端授权返回菜单。浏览器只按固定 RouteKey registry 装载动态页面。路由守卫和按钮权限提供 UX 控制，不能替代 RLS/Edge/RPC 权限检查。
- 角色菜单授权复用菜单路由的既有 permission key，不创建第二套 role-menu 关系。按钮权限由角色权限集合及服务端授权函数管理。
- Auth Session 以 `auth_user_id + JWT session_id` 唯一标识；`session_id` 仅用于客户端旧结果归属判断，服务端仍验证 JWT 和已登记应用 Session。Auth 协调器维护操作版本与待登出归属；Session Store 保存身份，Permission Store 保存授权快照。
- Auth 的 `SIGNED_IN`、`TOKEN_REFRESHED`、`USER_UPDATED` 在回调之后触发权限与导航刷新；焦点恢复和 60 秒轮询刷新会话。动态路由只在捕获的 `auth_user_id + session_id` 和操作版本仍匹配时安装。资料接口明确拒绝 Session 时按该 Session 清理本地状态；临时错误保留最后验证的 UI 状态。应用发起的 `setSession` / `signOut` 由跨标签 Web Lock 串行化；退出使用捕获 Session 的 token 撤销，仅在持久 Session ID 仍匹配时清本地 Auth Session。通知请求绑定 Profile 接收者、Session ID 检查和订阅版本。

## PC 导航

- 后台提供垂直、横向和混合三种 PC 导航布局。横向与混合布局的顶部菜单可左右滚动；内容超出可用宽度时显示方向控件，路由切换和窗口尺寸变化后将当前路由菜单项完整滚入视口。
- 当前横向导航的验收测试覆盖所有注册页面，并检查菜单目标完整可见、滚动控件可操作以及页面没有横向溢出。

## 数据功能

- 用户、角色、菜单、部门、岗位、字典、配置、Profile、消息、附件、审计与 Dashboard 均通过 Supabase RPC/表策略/Edge Functions。
- Dashboard 的待办是当前用户未读消息，不另建任务实体。消息的列表、详情、已读和 Realtime 事件受收件人 RLS 约束。
- 附件保存在私有 `admin-attachments` Storage bucket，元数据和对象权限分开控制；引用状态与 MIME/扩展名、大小受到数据库和 Storage 限制。
- 历史 MySQL 导入功能不属于新模板支持范围。历史 migration 保持不可变；新项目使用截止版本 `20261005084413` 的固定基线 `supabase/baselines/20261005084413/`。之后的增量 migration 同时镜像到两条轨道，升级验收会保留数据并用 `migration up`，不会重置升级中的数据库。

## 本地运行与质量入口

- Node `>=22.13.0`、pnpm `>=9`，项目固定 Node 24.18.0 / pnpm 12.3.4；Postgres Local major version 为 17。
- `pnpm supabase:start/status/stop` 管理本地栈；`pnpm dev` 同时启动 Edge Functions 与 Vite (`127.0.0.1:8848`)。Auth 邮件由本地 Mailpit 捕获。
- `pnpm check:docs` 检查活动 Markdown 本地链接和命令；`pnpm check:routes` 检查 RouteKey 合同、菜单元数据、权限键与可跟踪页面；`pnpm lint` 要求 Vue/TypeScript、共享合同、脚本和 Deno Edge Functions 零 warning。`pnpm typecheck` 检查全栈类型；`pnpm test:unit` 跑 Vitest/helper；`pnpm test:e2e:mock` 覆盖 PC UI 与 Session 竞态；`pnpm test:e2e:local` 覆盖本地 Supabase 浏览器链路；`pnpm test:db` 跑本地 pgTAP 与服务集成；`pnpm check:migrations` 验证历史空库重放；`pnpm check:migration-upgrades` 验证历史与临时基线的真实增量升级及固定基线、数据保留、账本、权限和完整 schema manifest。
- GitHub Actions 在 push/pull_request 上执行冻结安装、路由检查、源码 lint、类型检查、构建、单测、PC mock 浏览器测试和隔离 migration check。无生产部署配置。
