# 项目说明

PC 浏览器端管理后台模板，运行栈为 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse、TypeScript、Vite、pnpm、Zod 与 Supabase。Supabase 提供 PostgreSQL、Auth、Storage、Realtime 和 Edge Functions；项目不包含独立 Fastify/MySQL 后端。

## 工具与验证

- 在仓库根目录执行 `pnpm install`；根 `pnpm-lock.yaml` 管理整个 workspace。
- 本地开发：先启动 OrbStack/Docker-compatible runtime，再运行 `pnpm supabase:start` 和 `pnpm dev`。Vite 使用 8848 端口；Supabase Local 服务端口见 `supabase/config.toml`。
- 全栈 TypeScript 与 Deno Edge Function 检查：`pnpm typecheck`；生产构建：`pnpm build`；单元测试：`pnpm test:unit`。
- PC Chromium 浏览器 mock 测试：`pnpm test:e2e:mock`；本地 Supabase Auth 邮件恢复浏览器流程：`pnpm test:e2e:local`；本机栈数据库/Storage/Auth 集成：`pnpm test:db`。
- 完整隔离迁移验收：`pnpm check:migrations`。它复制 Supabase 配置到临时目录、使用唯一 project ID 和动态端口，从空库重放 migration 与 seed，再运行 pgTAP、服务检查及 PC 浏览器测试；只清理它创建的临时栈。

## 仓库级约束

- `.env*`、`node_modules/`、`dist/`、Supabase Local 状态、上传文件和本机 Agent 状态不入库。密钥只放本地环境变量；浏览器只允许使用 Supabase publishable key，service-role/secret key 不得进入浏览器或提交物。
- 不自动创建提交、不擅自推送；用户要求提交或推送时，按 `rules/git.md` 使用 `git-commit-push` Skill。
- 当前 Supabase 业务数据由 SQL migration 管理，初始目录数据由 `supabase/seed.sql` 管理；不得手工改写已应用 migration。结构变更新增 migration，不使用 `DROP ... CASCADE`。
- `pnpm supabase:db:reset` 会清空当前项目的 Supabase Local 数据库。运行前确认目标 project 和数据可丢弃；不得用于远程或用户现有业务数据库。
- 本仓库是模板仓库：不要写死特定业务方信息。接口或行为变化时同步维护 `specs/architecture.md`、README、规则和环境命令说明，并 grep 检查陈旧运行说明。

## 稳定领域约定

- 登录唯一使用 `login_name + 密码`，前端经 `session-login` Edge Function 建立已登记 Supabase Auth Session；邮箱只用于密码恢复。
- PostgreSQL RLS 是数据访问边界。前端动态菜单来自 `current_navigation()`，只通过固定 RouteKey registry 装载页面；按钮权限来自当前 Session 的权限键。
- 所有跨前后端输入/输出契约位于 `@template/contracts`，由前端与 Deno Edge Functions 共用 Zod schema。
- 角色的页面授权与已有权限键映射，不维护第二套 role-menu 关系。Dashboard 待办为当前用户未读消息。

## 状态恢复与按需指南

- 开始前阅读 `tasks/README.md` 与未完成任务记录；任务事实以 `tasks/` 为准，本地 `.agents/state/workflow.json` 只是提示。
- 命令和权限：`project.yml`；测试：`rules/testing.md`；安全：`rules/security.md`；架构：`specs/architecture.md`；目标架构：`docs/diagram/architecture.md`；需求 spec：`specs/template.md`。
- 环境事实和命令路由：`AI_ENVIRONMENT.md` 与 `docs/agent-environment/`。
- 进入 `frontend/` 后，读取 `frontend/AGENTS.md`。

## 项目 Skills

- `.agents/skills/tailwind-design-system/`：Tailwind CSS v4 与设计 token。
- `.agents/skills/typescript-advanced-types/`：复杂 TypeScript 类型设计。
- `.agents/skills/supabase/` 与 `.agents/skills/supabase-postgres-best-practices/`：Supabase Auth/RLS 与 PostgreSQL。
- `.agents/skills/shadcn/`：按用户要求安装的上游 `shadcn/ui` Skill；当前项目使用 Vue 的 `shadcn-vue`，组件和 API 以本仓库 `components.json`、`src/components/ui/` 与 `frontend/AGENTS.md` 为准，不照搬 React/TSX 示例或 `npx shadcn` 命令。
- 来源 commit 与技能目录 hash 见 `.agents/skills.sources.json` 和根 `skills-lock.json`。技能内容遵循同一项本地仓库规则与代码审查流程。
