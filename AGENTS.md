# 项目

全栈管理后台模板：Vue 3 + Vue Router + Pinia + shadcn-vue + Tailwind CSS v4 + VueUse 前端，Fastify + MySQL 后端，内置用户/角色/菜单/部门/字典/日志/消息/附件等基础模块，用于快速启动新的管理后台项目。前端 UI 正在分阶段迁移；侧栏、顶栏、面包屑、多标签、搜索、通知及已迁移页面使用 shadcn-vue，剩余旧页面仍使用 Element Plus 与既有 PureAdmin 派生工具。最重要的质量目标：前后端类型检查通过，登录与核心页面真实可运行。

## 工具与验证

- 前端包管理器：`pnpm`（>=9，`frontend/package.json#engines` 强制）；后端未锁定包管理器，用 npm 或 pnpm 均可。
- 启动前端：`cd frontend && pnpm install && pnpm dev`（端口 8848，`/api` 由 Vite 代理到 `http://localhost:3000`）。
- 启动后端：`cd backend && npm install && npm run dev`（端口 3000；需先准备 MySQL，执行 `backend/db/schema.sql` 和 `backend/db/seed.sql`，并按 `backend/.env.example` 创建 `.env`）。
- 类型检查：前端 `cd frontend && pnpm typecheck`；后端 `cd backend && npm run typecheck`。
- 测试：前端已有 Vitest 契约测试；Playwright 覆盖账号密码登录入口、应用壳、消息、用户/角色/菜单、组织、字典/配置、附件、三类审计日志、仪表盘及动态导航（业务页面使用隔离 mock）；Supabase Local pgTAP/test:db 检查 Auth/RLS、审计写入、dashboard 权限、私有附件 Storage、消息 Realtime 与导入幂等。真实慢刷新竞态与剩余浏览器验收仍待完成，见 `rules/testing.md`。

## 仓库级约束

- `.env*`、`uploads/`、`private-*/` 已被 `.gitignore` 排除；密钥、数据库口令只放本地 `.env`，不得写入提交物、文档或 Prompt。
- 不自动创建提交、不擅自推送；用户要求提交或推送时，通过 `git-commit-push` Skill 执行（见 `rules/git.md`）。
- 生产写入、发布、外部系统变更和破坏性操作必须获得人工批准（见 `rules/security.md`）。
- 本仓库是模板仓库：改动应让后续 fork/复制的项目直接受益，不写死特定业务方信息。
- 行为或接口契约变更时，同步更新受影响的文档（`specs/architecture.md`、根 `README.md`、前后端 `AGENTS.md` 等），并 grep 旧措辞确认没有残留的过期描述。

## 稳定领域概念

- `动态路由`：已迁移的应用导航从 Supabase `current_navigation()` 读取 RLS 过滤的菜单，前端只按固定 RouteKey registry 注册页面；Fastify `async-routes` 保留给尚未迁移的旧客户端。按钮级权限用前端 `v-perms` / `v-auth` 指令。改权限链路时同步更新 Supabase RLS/RPC 与前端守卫。

## 状态恢复

- 新会话先读 `tasks/README.md` 和 `tasks/` 中的未完成任务，恢复当前目标、进度与阻塞；任务事实以 `tasks/` 为准。`.agents/state/workflow.json`（存在时）仅作本地提示，缺失不代表没有未完成任务；冲突、多个任务或无任务时按 `tasks/README.md` 处理。需求讨论过程见 `workflow/`，历史决策见 `docs/adr/`。
- 开始新需求时更新本地 `.agents/state/workflow.json` 并在 `tasks/` 建立记录；完成后按 `tasks/README.md` 归档，避免过期进度误导后续会话。

## 按需指南

- 环境事实与按任务路由：`AI_ENVIRONMENT.md`
- 项目命令、写入范围与权限：`project.yml`
- 测试约定：`rules/testing.md`
- Git 工作区与提交规则：`rules/git.md`
- 安全边界：`rules/security.md`
- 架构与接口事实：`specs/architecture.md`
- 需求 spec 模板：`specs/template.md`
- 规则维护（仅限创建/重构/审计规则文件时）：`.agents/skills/agents-maintenance/`

## 局部规则

- 进入 `frontend/` 后，读取 `frontend/AGENTS.md`。
- 进入 `backend/` 后，读取 `backend/AGENTS.md`。
