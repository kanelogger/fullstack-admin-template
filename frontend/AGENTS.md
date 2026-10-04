# 范围

管理后台前端：Vue 3 + Vue Router + Pinia + shadcn-vue + Tailwind CSS v4 + VueUse，使用 Vite 7 构建，负责全部页面、路由、状态与 API 封装。UI 正在分阶段从 Element Plus 迁移；登录/密码恢复、Profile、消息中心、用户/角色/菜单、组织、字典、配置、附件、三类审计日志、仪表盘，以及侧栏、顶栏、面包屑、多标签、搜索、通知已使用 Supabase/Zod/shadcn-vue；少数旧共享组件仍待迁移。Supabase `current_navigation()` 已接管应用动态路由，Fastify `async-routes` 只保留为旧接口。

## 局部约束

- Node 最低 `>=22.13.0`，Volta 固定 Node 24.18.0 与 pnpm 12.3.4；前端包管理器固定 `pnpm`（>=9）。
- shadcn-vue 组件源码位于 `src/components/ui/`，主题变量与 Tailwind CSS v4 入口位于 `src/style/tailwind.css`，配置位于 `components.json`。
- 新增 shadcn-vue 组件可运行 `pnpm dlx shadcn-vue@latest add <component>`，生成源码放入本仓库维护。
- 新页面优先使用 `src/components/ui/` 中的 shadcn-vue 组件和 Tailwind 工具类；迁移旧页面时保持 API、路由权限和业务行为不变。
- `dev`/`build` 脚本内联 `NODE_OPTIONS=...`（POSIX 写法）；Windows cmd 不识别，本机用 Git Bash 运行，或改用 cross-env 等价写法。
- Fastify 旧模块请求走 `/api` 前缀，经 `src/utils/http/index.ts` 封装；dev 代理由 `vite.config.ts` 转发到 `http://localhost:3000`。Supabase Auth 与已迁移功能通过 feature service/repository 调用 Supabase JS，不能绕过契约直接在页面写数据请求。
- 登录只提供 `login_name` + 密码；浏览器只能通过 `session-login` Edge Function 获取应用 Session，不得直接调用 Auth 密码登录。服务端登记的 Session 才能访问业务数据；邮箱只用于密码重置，公共注册关闭。不要增加 OTP/魔法链接、短信、OAuth、SSO 或 Passkey 登录入口。
- 跨模块 Zod 契约位于 `src/contracts/`。Supabase Local 配置和 migrations 位于仓库根 `supabase/`；从 `frontend/` 执行 `pnpm run supabase:start/status/stop`，本地数据库重建命令为 `pnpm run supabase:db:reset`。
- 验证入口：`pnpm typecheck`、`pnpm test:unit`、`pnpm test:e2e`（16 项账号密码登录、应用壳、消息、用户/角色/菜单、组织、字典/配置、附件、审计日志、仪表盘及导航 smoke；业务 API 使用隔离 fixtures/mock）、`pnpm test:e2e:auth`（本地 Auth 邮件恢复、SPA 改密、账号密码登录和本人 Profile）、`pnpm run test:db`（本地 Supabase 413 项 pgTAP/RLS、审计日志、仪表盘权限、私有 Storage、角色/菜单/组织/字典/配置、Session、消息 Realtime 和导入幂等）、`pnpm test:auth-bridge`（专用 MySQL 测试库、Supabase Local、Fastify；验证账号密码 bridge、动态菜单、有效/无效旧 Token 刷新）。常规动态导航与模块 smoke 使用隔离 fixtures；真实慢刷新期间退出/切换账号仍待端到端验收。
- 环境变量按 `.env.example`、`.env.development.example` 复制为本地 `.env*`；真实文件不提交。

## 按需指南

- 权限指令（`v-perms`/`v-auth`）：`src/directives/`
- 布局与多标签：`src/layout/`、`src/store/modules/multiTags.ts`
