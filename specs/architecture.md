# 架构与接口事实

本文件记录当前仍然有效、且不能从单一文件一眼看全的契约性事实。实时实现细节以代码为准；本文件随实现核实更新，旧结论被取代时标明替代关系。最近核实：2026-09-28（对照 `backend/src/app.ts`、`frontend/vite.config.ts`、`backend/db/schema.sql`）。

## 总体结构

- 单仓库两端：`frontend/`（Vue 3 SPA，端口 8848）+ `backend/`（Fastify API，端口 3000）。
- 开发链路：浏览器 → Vite dev server（8848）→ `/api` 代理（`frontend/vite.config.ts`，去掉 `/api` 前缀）→ Fastify（3000）→ MySQL。
- 生产链路未定义（无部署配置），发布相关事项需先与用户确认。

## 后端契约

- 全局鉴权：`app.ts` 注册 `onRequest` 钩子 `requireAuth`；仅 `WHITELIST`（`/login`、`/refresh-token`、`/captcha`，见 `src/utils/jwt.ts`）免登录。
- 统一响应：成功 `{ success: true, data }`；失败 `{ success: false, error: { code, message, details? } }`（`src/utils/response.ts`）。业务错误抛 `AppError`（`src/utils/errors.ts`），由全局错误处理转换，未捕获异常会写入异常日志表并返回 500。
- Token：access（分钟级，`ACCESS_TOKEN_TTL_MINUTES`）+ refresh（天级，`REFRESH_TOKEN_TTL_DAYS`），payload `{ userId, username, type }`。
- 模块路由（均在 `app.ts` 注册）：auth、users、user-management、role-management、menu-management、org-management、dict-management、config-management、profile、attachments、messages、dashboard、logs、async-routes。
- 数据库：MySQL，库名默认 `admin_template`；表结构 `db/schema.sql`，初始数据（含默认账号与基础菜单）`db/seed.sql`。改表结构时两个文件需同步维护。

## 前端契约

- 登录后从后端 `getAsyncRoutes` 拉取动态路由生成菜单；按钮级权限用 `v-perms` / `v-auth` 指令。
- HTTP 统一封装在 `src/utils/http/index.ts`；业务代码不直接 import axios。
- 环境变量：`VITE_API_BASE_URL`（默认 `/api`）、`VITE_PORT`、`VITE_ROUTER_HISTORY` 等，见各 `.env*.example`。

## 暂无

- 无自动化测试、无 E2E、无 CI、无 MCP/外部连接。引入后在根 `AGENTS.md` 和 `rules/testing.md` 登记入口。
