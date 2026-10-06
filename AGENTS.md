# 项目说明

PC 浏览器端管理后台模板，运行栈为 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse、TypeScript、Vite、pnpm、Zod 与 Supabase。Supabase 提供 PostgreSQL、Auth、Storage、Realtime 和 Edge Functions；项目不包含独立 Fastify/MySQL 后端。

## 命令与运行条件

命令、前置条件与副作用以 `docs/agent-environment/commands.md` 为准；权威来源是根 `package.json`、`frontend/package.json` 与 `supabase/config.toml`。以下条件环境不会记录：

- 在仓库根目录执行 `pnpm install`；根 `pnpm-lock.yaml` 管理整个 workspace。
- 首次启动 Supabase Local 前先选 migration 轨道：`pnpm template:select-migrations -- --track baseline`；已有账本的项目不可换轨。本地状态或 Docker 数据卷无法核实时命令会拒绝修改。
- 本地开发先启动 OrbStack/Docker-compatible runtime，再运行 `pnpm supabase:start` 和 `pnpm dev`；Vite 使用 8848 端口，Supabase Local 服务端口见 `supabase/config.toml`。
- `pnpm check:migrations` 与 `pnpm check:migration-upgrades` 只在自建临时栈上验收并只清理自建栈；`upgrades` 不重置数据库，探针不入账本且比较前清理。
- `pnpm supabase:db:reset` 清空当前项目 Local 数据库，只用于可丢弃数据；不得连接远程或用户现有业务数据库。

## 仓库级约束

- `.env*`、`node_modules/`、`dist/`、Supabase Local 状态、上传文件和本机 Agent 状态不入库。密钥只放本地环境变量；浏览器只允许使用 Supabase publishable key，service-role/secret key 不得进入浏览器或提交物。
- 不自动创建提交、不擅自推送；用户要求提交或推送时，按 `rules/git.md` 使用 `git-commit-push` Skill。
- 当前 Supabase 业务数据由 SQL migration 管理，初始目录数据由 `supabase/seed.sql` 管理；不得手工改写已应用 migration。结构变更新增 migration，不使用 `DROP ... CASCADE`。
- 本仓库是模板仓库：不要写死特定业务方信息。接口或行为变化时同步维护 `specs/architecture.md`、README、规则和环境命令说明，并 grep 检查陈旧运行说明。

## 稳定领域约定

- 登录唯一使用 `login_name + 密码`，前端经 `session-login` Edge Function 建立已登记 Supabase Auth Session；邮箱只用于密码恢复。
- 同账号不同登录仍是不同 Session，以 `auth_user_id + session_id` 唯一标识；协调器按操作版本决定转换。身份、授权与登出机制见 `specs/architecture.md` 与 `frontend/AGENTS.md`。
- PostgreSQL RLS 是数据访问边界。前端动态菜单来自 `current_navigation()`，只通过固定 RouteKey registry 装载页面；按钮权限来自当前 Session 的权限键。
- 所有跨前后端输入/输出契约位于 `@template/contracts`，由前端与 Deno Edge Functions 共用 Zod schema。
- 角色的页面授权与已有权限键映射，不维护第二套 role-menu 关系。Dashboard 待办为当前用户未读消息。

## 状态恢复与按需指南

- 开始前阅读 `tasks/README.md` 与未完成任务记录；任务事实以 `tasks/` 为准，本地 `.agents/state/workflow.json` 只是提示。
- 命令、权限与副作用：`project.yml`；测试：`rules/testing.md`；安全与凭据：`rules/security.md`；架构：`specs/architecture.md`；目标架构：`docs/diagram/architecture.md`；需求 spec：`specs/template.md`。
- 环境事实和命令路由：`AI_ENVIRONMENT.md` 与 `docs/agent-environment/`。
- 进入 `frontend/` 后，读取 `frontend/AGENTS.md`。

## 项目 Skills

`.agents/skills/` 内的技能按各自描述触发。shadcn 例外：本仓库使用 shadcn-vue，组件与 API 以 `components.json`、`src/components/ui/` 和 `frontend/AGENTS.md` 为准；不套用上游 React/TSX 示例或 `npx shadcn`。技能来源 commit 与目录 hash 见 `.agents/skills.sources.json` 和 `skills-lock.json`。
