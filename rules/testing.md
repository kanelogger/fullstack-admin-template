# Testing Rules

前端已有 Vitest 契约测试与 Playwright 执行入口；常规 Playwright 覆盖登录页、应用壳、消息、用户、角色/菜单、组织、字典/配置、附件、三类审计日志、仪表盘与动态导航权限，业务 API 使用隔离 fixtures/mock。`test:e2e:auth` 使用本地 Mailpit 真实验证恢复邮件链接和账号密码登录；`test:auth-bridge` 验证本地 Supabase 到 Fastify/MySQL 的旧接口桥接及旧 Token 刷新。Storage/RLS、登录审计事件、用户管理操作审计和 Dashboard RPC 权限使用真实本地 Supabase/Edge 会话或 pgTAP 验证；真实慢 Token 刷新期间退出/切换账号与剩余核心 CRUD 仍待端到端验收。

## 验证分层

| 改动类型 | 最低验证 |
| --- | --- |
| 前端行为或类型变更 | `cd frontend && pnpm typecheck` + 启动 `pnpm dev` 真实打开受影响页面 |
| 契约 / 纯逻辑 | `cd frontend && pnpm test:unit` |
| 后端行为或类型变更 | `cd backend && npm run typecheck` + 启动 `npm run dev` 真实调用受影响接口 |
| 前后端契约（接口字段、响应结构） | 两端类型检查 + 浏览器走通该功能的完整请求链路 |
| 文档、无行为变化的配置 | 对应文件自查即可 |

## 执行原则

- 测试存在不等于功能可用；关键路径必须真实运行（真实浏览器或真实 HTTP 请求），并报告实际命令、退出码与关键输出。
- Bug 修复先复现原问题，修复后确认同一操作不再出现，再交付。
- 当前 E2E 覆盖有限：不能把部分页面冒烟描述为完整业务链路验收；交付时说明未覆盖的风险。开发期间只跑针对性场景，交付前在最终代码上跑全套；全套后再改动须重跑。
- 验证产生的数据、账户、文件和进程必须清理；不得污染 `backend/db/seed.sql` 定义的初始数据基线。
- 未完成、跳过或失败的检查必须明确报告原因与风险。

## 已建立的前端入口

- `cd frontend && pnpm test:unit`：Zod 契约与纯逻辑单元测试。
- `cd backend && npm run test:migration:accounts`、`test:migration:menus`、`test:migration:messages`、`test:migration:organization`、`test:migration:dictionary-configuration`、`test:migration:attachments`、`test:migration:audit-logs`：分别离线验证源记录映射、signed BIGINT、脱敏、业务键和时区，不连接数据库。
- `cd frontend && pnpm test:e2e`：Playwright 启动 Vite 和 Chromium；常规 16 项覆盖账号密码入口、应用壳、消息中心、用户/角色/菜单、组织、字典/配置、附件、审计日志、仪表盘及动态导航权限，业务服务响应由隔离 fixtures 提供。本地 Auth 恢复 spec 在此命令中跳过。
- `cd frontend && pnpm test:e2e:auth`：要求本地 Supabase、Mailpit 和专用合成 MySQL 测试配置；真实打开恢复邮件链接，在 SPA 改密后用账号密码登录并读取本人 Profile，测试撤销会话并删除本轮邮件，不重建数据库。
- `cd frontend && pnpm run test:db`：Supabase Local 已运行时，自动建立隔离 Auth、Profile、消息、附件和审计 fixture，执行 `supabase/tests/` 中的 413 项 pgTAP，并验证认证/RLS、Dashboard 权限、审计事件、组织/字典/配置/附件 RPC、私有 Storage 上传/读取/删除权限、导入幂等、消息 Realtime、用户管理 Edge 和 Mailpit Recovery；脚本清理临时账号、对象、元数据、登录/操作日志、消息和邮件。CLI 产生的 service-role key 只在进程内使用，不打印或保存。
- `cd frontend && pnpm test:auth-bridge`：要求专用 MySQL 测试库配置、Supabase Local、Mailpit 和本机 Fastify；使用合成 SUPER_ADMIN 恢复密码，验证账号密码登录、Session 登记、匿名拒绝、Fastify legacy-token bridge、动态菜单、有效刷新及无效刷新拒绝；撤销测试会话并删除本轮邮件。
- `cd frontend && pnpm run supabase:db:reset`：仅限已确认归属的 disposable 本地 Supabase 栈；会清空该栈数据库并重放 migrations/seed。

本地真实 Auth 浏览器恢复流程与账号密码登录、用户 A/B 数据隔离、消息 Realtime 收件人隔离、组织/字典/配置、附件 Storage/RLS、审计事件和 Dashboard 权限范围已通过；审计及仪表盘页面的 Playwright 用例使用隔离 fixtures。刷新期间退出/切换账号的真实慢请求、Fastify bridge 浏览器链路和 Profile 保存仍待验收。附件与审计导入器默认只读预览；仅传 `--apply-local` 才写入 Supabase Local，实际导入前先核对源库和映射。
