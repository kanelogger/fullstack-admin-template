# 项目

全栈管理后台模板：Vue 3 + Element Plus 前端（基于 vue-pure-admin）+ Fastify + MySQL 后端，内置用户/角色/菜单/部门/字典/日志/消息/附件等基础模块，用于快速启动新的管理后台项目。最重要的质量目标：前后端类型检查通过，登录与核心页面真实可运行。

## 工具与验证

- 前端包管理器：`pnpm`（>=9，`frontend/package.json#engines` 强制）；后端未锁定包管理器，用 npm 或 pnpm 均可。
- 启动前端：`cd frontend && pnpm install && pnpm dev`（端口 8848，`/api` 由 Vite 代理到 `http://localhost:3000`）。
- 启动后端：`cd backend && npm install && npm run dev`（端口 3000；需先准备 MySQL，执行 `backend/db/schema.sql` 和 `backend/db/seed.sql`，并按 `backend/.env.example` 创建 `.env`）。
- 类型检查：前端 `cd frontend && pnpm typecheck`；后端 `cd backend && npm run typecheck`。
- 测试：项目暂无自动化测试和 E2E。行为变更的验证分层与报告要求见 `rules/testing.md`；新增关键用户路径时优先为其建立 E2E。

## 仓库级约束

- `.env*`、`uploads/`、`private-*/` 已被 `.gitignore` 排除；密钥、数据库口令只放本地 `.env`，不得写入提交物、文档或 Prompt。
- 不自动创建提交、不擅自推送；用户要求提交或推送时，通过 `git-commit-push` Skill 执行（见 `rules/git.md`）。
- 生产写入、发布、外部系统变更和破坏性操作必须获得人工批准（见 `rules/security.md`）。
- 本仓库是模板仓库：改动应让后续 fork/复制的项目直接受益，不写死特定业务方信息。
- 行为或接口契约变更时，同步更新受影响的文档（`specs/architecture.md`、根 `README.md`、前后端 `AGENTS.md` 等），并 grep 旧措辞确认没有残留的过期描述。

## 稳定领域概念

- `动态路由`：菜单和路由由后端按角色下发（`backend/src/routes/async-routes.ts`、`menu-management`），前端登录后拉取生成路由；按钮级权限用前端 `v-perms` / `v-auth` 指令。改权限链路时前后端必须一起改。

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
