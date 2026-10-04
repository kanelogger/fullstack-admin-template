# Supabase 架构迁移与本机环境

## 目标与范围

用户已批准按 `docs/diagram/architecture.md` 进行完整迁移，按可验证业务切片推进，迁移期间保留 Fastify/MySQL 作为旧功能运行基线。长期目标和验收条件见 `tasks/20261001-supabase-architecture-migration.md`。

用户确认应用登录只保留 `login_name` + 密码；邮箱仅发送密码恢复邮件。浏览器只能经 `session-login` Edge Function 建立应用 Session；Edge Function 登记 session_id，RLS 与旧 JWT bridge 同时校验密码 AMR 和私有 Session 白名单。全局及 email provider 公共注册、手机号注册和 Passkey 均关闭。Recovery OTP 仅用于重置，不能读业务数据或换取旧 JWT；重置要求服务端请求标记和私有密码哈希快照校验。

用户补充要求把本机开发工具链固化到项目：Volta 管 Node，yrm 管 npm registry，前端使用 pnpm、旧后端使用 npm，OrbStack 提供 Docker 运行时。

## 评估和取舍

- 用两个现有 package manifest 的 `volta` 字段固定项目 Node 和相应包管理器，沿用前端已有 pnpm 与后端 npm 分工；不新增根 package.json，避免改变两个独立项目的安装边界。
- Node 最低版本提升到 `>=22.13.0`，与当前 Supabase JS 支持边界一致；Volta 固定本机参考 Node 24.18.0。最低兼容范围和本机固定版本分别表达，不把机器补丁版本当成所有环境的最低要求。
- yrm 1.0.6 已多年未发布且会修改用户级 npm registry。保留使用说明，不把它作为项目依赖或提交 registry 地址、凭据；切换后核对 npm 与 pnpm 当前源。
- OrbStack 是本机 Docker-compatible runtime；不提交 Docker socket、个人路径或密钥。Supabase Local 需要显式启动 OrbStack 并由本地 Docker socket 驱动。

## 当前验证状态

截至 2026-10-02，本机工具二进制可见；此前已确认 OrbStack 运行。本轮经授权访问确认本地 Supabase API/Postgres 可用，只有 imgproxy、Edge runtime 和 pooler 容器显示停止；没有链接远程项目。

现有 Token 刷新代码允许 Access Token Cookie 到期后从 localStorage 取 Refresh Token，并在 Cookie 存在时才校验其值；会话版本校验阻止旧刷新覆盖退出/切换后的凭据。真实本地 Auth 浏览器恢复流程和 Supabase→Fastify bridge 已验证；`test:auth-bridge` 还覆盖有效/无效旧 Refresh Token。真实浏览器慢刷新期间退出/切换账号仍待验收。

用户选定过渡兼容方式：前端通过 Supabase Edge Function 完成 login_name/email 映射与 Auth 密码验证，随后把 Supabase bearer 交给 Fastify `/session/legacy-token`；Fastify 再调 Supabase Auth `/user` 和调用者范围的 `current_business_user_id()` RPC，签发短期旧 JWT。Fastify 使用 publishable key，不持有 service-role；登录不写回 MySQL。未迁移模块继续通过旧 JWT 工作。

迁移范围限制：Postgres `BIGINT` 使用 signed 范围；当前 Fastify `request.user.userId` 是 JS `number`。账号预检新增两个上限查询；超出任一边界的 ID 必须先处理或等旧接口退出后再迁移，不能静默取整。

## 消息中心切片

已添加 `supabase/migrations/20261001122856_message_center.sql`：收件箱表、仅收件人可读/改已读的 RLS、使用文本 BIGINT ID 的 invoker read model、受限幂等导入 RPC 和 Realtime publication。前端 Zod 契约、Supabase feature service、shadcn-vue 消息页和 Pinia notification store 已接入；顶部未读角标与页面消息列表共用 Realtime 更新。专用 MySQL 合成测试库的 4 条历史消息已导入 Supabase Local；真实业务库历史消息仍需单独预检并导入。MySQL 菜单授权关系尚未导入。

本地 `test:db` 验证收件人隔离、BIGINT 文本 ID、未读计数/详情/已读、Realtime INSERT/UPDATE 仅到收件人、恢复改密，以及历史消息导入 RPC 的 dry-run、BIGINT 精度、幂等/冲突拒绝和 identity sequence 推进；fixture、账号和邮件均清理。离线 `test:migration:messages` 覆盖 MySQL 字段映射和 signed BIGINT/时区输入校验。`pnpm test:auth-bridge` 另用合成 MySQL SUPER_ADMIN 验证真实 Fastify bridge 与旧菜单 API。浏览器真实恢复链接测试已通过；其余 Playwright 页面用例使用隔离 fixtures。

早期鉴权阶段已改配置和代码：全局与 email provider 公共注册关闭；账号登录 Edge Function 登记 password Session；RLS/旧 JWT bridge 检查登记；前端退出撤销登记。早期 pgTAP 79 项与一次受控 `test:db` 通过。后续角色/菜单迁移和本地全链路复验的最新证据见下方。

## 用户、角色与菜单管理切片

使用专用本地 MySQL 测试库做只读预检后，导入 3 个合成账号与 4 条历史消息到 Supabase Local；不迁移 MySQL 密码哈希，不把 Mailpit 测试邮件用于真实账号。账号管理通过 Edge Function 检查权限并创建/停用/软删除账号，强制邮箱重置；角色页用 RPC 管理角色和权限集合。菜单管理以固定 RouteKey allowlist、security-invoker 读模型与权限校验写 RPC 落在 Supabase。登录唯一方式仍是账号密码，邮箱 OTP 仅用于重置。

应用壳侧栏、顶栏、面包屑、多标签、搜索和通知已迁到 shadcn-vue/Tailwind。当前前端检查为类型检查通过、Vitest 36 项通过、生产构建通过；常规 Playwright 9 项通过，另有 1 项本地 Auth 测试在常规套件中跳过，真实 Mailpit 恢复浏览器测试单独通过。Supabase 本地 `test:db` 304 项 pgTAP、Edge/RLS/Realtime 和数据导入检查通过。Realtime BIGINT 事件 payload 仍是 JS 数字，超出安全整数时可能舍入；应用只用事件触发刷新，回查 read model 获得精确字符串 ID。

应用导航现在通过 Supabase `current_navigation()` 读取按 RLS 过滤的固定 RouteKey 菜单，前端只从本地 registry 加载组件；旧 Fastify `async-routes` 留给尚未迁移的客户端。COMMON_USER 导航恢复/403 直达与角色、菜单 smoke 的浏览器用例使用隔离 fixtures，通过针对性及全套测试。真实本地 Auth 浏览器恢复、改密、账号密码登录和本人资料读取已通过；`test:auth-bridge` 也验证了有效旧刷新令牌与无效令牌拒绝。组织/字典/配置切片的页面、迁移、RLS/RPC、浏览器 smoke 和 pgTAP 已完成；本地导入 2 部门、4 岗位、3 字典类型、9 字典项和 6 条配置，外键已验证。

## 附件 Storage 切片（2026-10-02）

附件页现通过 `frontend/src/features/attachments/attachments.service.ts` 使用 Supabase 私有 Storage 与元数据 read model；页面已迁到 shadcn-vue/Tailwind。RLS 基于注册的密码 Session，读、上传、删除使用独立权限键；上传只能写入当前业务用户路径，删除权限由服务端检查，上传者仅能清理尚未登记的孤儿对象。Metadata RPC 验证对象存在后创建记录，软删除前先删除 Storage 对象。历史导入仅限 service_role，保留文本 BIGINT、原状态、独立可空业务模块/记录字段与时间戳，并核对活动源文件与元数据大小。

真实本地 Storage 测试覆盖管理员上传/读取/删除、OPERATOR 授权读取且上传和删除被拒、普通用户无法读取；service_role 导入覆盖 preview 无写入、apply、幂等重试、原数据保留与对象读取。`test:db` 最新通过 353 项 pgTAP 与 Edge/Storage 测试；新增 migration advisors 和 lint 均无警告/错误。专用 MySQL 测试库附件只读预览为 0 行。附件 Playwright smoke、契约测试、7 项离线 importer 测试通过。附件后全量前端单测 39 项、类型检查、生产构建通过；Playwright 10 项通过、1 项本地 Auth 用例跳过。

下一步：日志审计与仪表盘切片已完成，继续核验独立空库 migrations/seed 重放，清理旧页面/共享组件中的 Element Plus/PureAdmin；在安全浏览器环境完成慢 Token 刷新时退出/切换账号的真实竞态验收。所有模块达标后再清理 Fastify/MySQL 旧链路。

## 审计日志与仪表盘（2026-10-02）

日志页改为 Supabase `login_log_read_model`、`operation_log_read_model`、`exception_log_read_model`；三个基表启用 RLS，只授予 `audit.logs.read` 的注册密码 Session 读取。`session-login` 记录密码登录成功、失败和服务异常；已迁移业务表的数据库触发器记录成功变更的最小 ID 参数；用户管理 Edge Function 记录变更而不传密码/邮箱；异常 writer 只向 service_role 开放。历史导入 RPC 仅 service_role 可调用，离线 importer 默认只读并对请求参数/错误文本做脱敏，未映射 actor ID 变为空值并保留名称快照。

`dashboard_overview()` 对 dashboard 权限做入口校验，消息数/公告限定本人，近期操作在无审计权限时仅返回本人记录，用户/角色/菜单/登录/异常统计分别按模块读取权限填充。COMMON_USER 无 dashboard 权限，OPERATOR 默认仅看被授权 dashboard 和本人活动，SUPER_ADMIN 可读授权统计。

本地 `test:db` 通过 413 项 pgTAP，含三类审计日志 RLS、日志触发器、login/operation/exception writers、历史导入 preview/apply/幂等，以及三种角色的 dashboard 数据范围；账号密码 Edge 登录成功/失败、user-management audit 写入和附件 Storage 集成通过。审计/dashboard Playwright 5 项与完整 Playwright 套件 15 项通过、1 项本地 Auth spec 跳过；另有真实 Mailpit Auth browser test 通过。Production build 和 46 项 Vitest 通过。独立 MySQL 测试库三类历史日志预览 0 行，无旧日志实际导入。

切换边界：Supabase UI 显示新的 Supabase 审计事件与导入历史；迁移期间旧 Fastify 兼容客户端继续写 MySQL 日志，这部分新事件暂留旧系统，兼容链路退出后再删旧记录写入端。下一步核验独立 disposable Supabase 栈从空库重放，再处理旧 UI/依赖和 legacy-token bridge 的退出顺序。
