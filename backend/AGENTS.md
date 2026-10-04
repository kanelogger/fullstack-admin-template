# 范围

后端 API：Fastify 5 + mysql2 + JWT（jsonwebtoken），TypeScript，开发期 nodemon + ts-node，提供认证与各管理模块接口。

## 局部约束

- 启动前需 MySQL 就绪：按 [数据库初始化指南](../docs/agent-environment/commands.md#数据库初始化) 建立与 `MYSQL_DATABASE` 一致的专用本地库，获准后显式指定目标库，依次导入 `db/schema.sql`、`db/seed.sql`（Schema 会删表）；配置经 `.env`（参照 `.env.example`），`PORT`、`JWT_SECRET` 和 `MYSQL_PASSWORD` 必须由本地环境提供，端口默认 3000。
- Node 最低 `>=22.13.0`；Volta 固定 Node 24.18.0 与 npm 12.0.2。后端依赖仍使用 npm，不要创建或提交 lockfile，除非任务明确要求。
- Supabase Auth 迁移中的登录只支持 `login_name` + 密码，邮箱只用于密码重置；旧 API bridge 除验证 Auth 用户和 `amr=password` 外，还要求 `current_business_user_id()` 确认该 Session 已由账号登录 Edge Function 登记。浏览器不可持有 service-role key。`/login` 已停用，旧模块临时 JWT 由 bridge 签发。
- 消息中心前端已切到 Supabase/Postgres；Fastify `/messages` 仅保留给尚未迁移的旧客户端，新增前端消息调用必须走 `frontend/src/features/messages/`。
- 分层固定：`routes/`（参数校验与转发）→ `services/`（业务与 SQL）→ `db/mysql.ts`（连接池）；新模块沿用此分层，不在 route 里写 SQL。
- 统一响应结构用 `src/utils/response.ts` 的 `sendSuccess`/`sendError`；业务错误抛 `src/utils/errors.ts` 的 `AppError`，由 `app.ts` 全局错误处理统一转换并记录异常日志。
- 鉴权：`app.ts` 的 `onRequest` 钩子 `requireAuth` 全局生效；新增免登录接口需在 `src/utils/jwt.ts` 的白名单中显式登记。
- 类型检查 `npm run typecheck`；离线测试分别运行 `npm run test:migration:accounts`、`test:migration:menus`、`test:migration:messages`、`test:migration:organization`、`test:migration:dictionary-configuration`、`test:migration:attachments`、`test:migration:audit-logs`。`npm run migrate:messages`、`migrate:organization`、`migrate:dictionary-configuration`、`migrate:attachments`、`migrate:audit-logs` 默认只读预览，必须核对本机 MySQL 源库及时区并传 `--confirm-source-database`；仅传 `--apply-local` 才向本项目 Supabase Local 插入数据，导入端绝不写 MySQL。组织数据须先于账号部门/岗位关系回填；字典/配置需先完成 Auth 用户映射，字典项数据按类型→项顺序导入；附件导入需先完成用户 Profile 映射，并核实 `backend/uploads/attachments` 中活动文件与 MySQL 元数据一致；审计日志导入会将无映射的旧用户 ID 置空并保留操作人快照，对参数/文本中的凭据做脱敏。验证要求见根目录 `rules/testing.md`。

## 按需指南

- 数据库表结构：`db/schema.sql`；初始数据（含默认账号）：`db/seed.sql`
