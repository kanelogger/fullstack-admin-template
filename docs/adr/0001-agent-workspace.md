# 0001. 建立项目级 Agent 工作环境

- 日期：2026-09-29
- 状态：生效
- 背景：仓库需要让没有历史对话的新会话，仅通过项目文件恢复项目身份、当前事实、可执行命令、权限边界和任务流程。运行态、锁、缓存和凭据不应成为版本化事实。
- 决策：根目录 `AGENTS.md` 只保留稳定角色和入口；项目命令、写入范围和人工门禁集中在 `project.yml`；环境事实由 `AI_ENVIRONMENT.md` 路由到 `docs/agent-environment/`；`rules/`、`specs/`、`tasks/`、`workflow/` 和 `docs/adr/` 按用途分层；阶段、锁、缓存和本地证据放在被忽略的 `.agents/state/`。当前只登记仓库内的 `agents-maintenance` Skill，不登记未固定版本的外部来源。
- 备选方案与否决原因：保留根目录运行态文件会把易过期的会话状态提交到仓库，已迁移到 `.agents/state/workflow.json`；直接复制未固定版本的外部 Skill 来源清单会制造无法执行的能力声明，已改为空来源索引，待实际固定版本后再登记。
- 证据：改造规范 `docs/01-把仓库变成Agent的工作环境/01-把仓库变成Agent的工作环境.md`；当前命令事实来自 `frontend/package.json`、`backend/package.json`、`frontend/vite.config.ts`、`backend/src/config/index.ts`；当前工具探测和未覆盖项见 `AI_ENVIRONMENT.md`。
