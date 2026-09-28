# 范围

后端 API：Fastify 5 + mysql2 + JWT（jsonwebtoken），TypeScript，开发期 nodemon + ts-node，提供认证与各管理模块接口。

## 局部约束

- 启动前需 MySQL 就绪：建库后依次执行 `db/schema.sql`、`db/seed.sql`；配置经 `.env`（参照 `.env.example`），端口默认 3000。
- 分层固定：`routes/`（参数校验与转发）→ `services/`（业务与 SQL）→ `db/mysql.ts`（连接池）；新模块沿用此分层，不在 route 里写 SQL。
- 统一响应结构用 `src/utils/response.ts` 的 `sendSuccess`/`sendError`；业务错误抛 `src/utils/errors.ts` 的 `AppError`，由 `app.ts` 全局错误处理统一转换并记录异常日志。
- 鉴权：`app.ts` 的 `onRequest` 钩子 `requireAuth` 全局生效；新增免登录接口需在 `src/utils/jwt.ts` 的白名单中显式登记。
- 类型检查 `npm run typecheck`；无测试脚本，验证要求见根目录 `rules/testing.md`。

## 按需指南

- 数据库表结构：`db/schema.sql`；初始数据（含默认账号）：`db/seed.sql`
