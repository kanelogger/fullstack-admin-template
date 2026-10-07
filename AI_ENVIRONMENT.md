# Agent 环境索引

按任务读取项目资料。静态约定和事实源保存在仓库；本机版本、依赖状态、端口、服务健康与会话状态写入被忽略的 `.agents/state/`，换工作区后重新探测。

| 任务 | 入口 |
| --- | --- |
| 命令和副作用 | [`docs/agent-environment/commands.md`](docs/agent-environment/commands.md)、[`project.yml`](project.yml) |
| Supabase Local 与 Vite | [`docs/agent-environment/services.md`](docs/agent-environment/services.md) |
| 工具、浏览器和权限探测 | [`docs/agent-environment/capabilities.md`](docs/agent-environment/capabilities.md) |
| 文件系统、worktree 和状态协议 | [`docs/agent-environment/network-filesystem.md`](docs/agent-environment/network-filesystem.md) |
| GitHub Actions 和环境差异 | [`docs/agent-environment/ci-parity.md`](docs/agent-environment/ci-parity.md) |
| Node、pnpm、Docker | [`docs/agent-environment/local-toolchain.md`](docs/agent-environment/local-toolchain.md) |
| 任务恢复 | [`tasks/README.md`](tasks/README.md)、[`workflow/README.md`](workflow/README.md) |
| Agent 规则维护 | [agents-maintenance](.agents/skills/agents-maintenance/SKILL.md) |

## 事实与安全边界

- 命令以根 `package.json`、`frontend/package.json` 和 Supabase 配置为准；`project.yml` 登记执行条件与副作用。
- 当前架构与接口以 [`specs/architecture.md`](specs/architecture.md) 和源码为准；决策原因见 [`docs/adr/`](docs/adr/)。
- 权限与凭据处理见 [`rules/security.md`](rules/security.md)。仓库声明的能力不代表当前会话已经获得相应授权。
- 环境探测结果记录 `scope`、`owner`、`evidence`、`verified_at` 和 `status`。没有本轮证据时不能从旧会话继承 `healthy`。
- 仓库支持 PC Chromium Playwright、Node/Vue jsdom Vitest、固定 Linux Playwright visual baseline 和 Supabase 隔离迁移校验。Dashboard BrowserSkill 试点要求调用时指定一个已连接的浏览器实例；环境声明不代表实例已连接。生产部署和外部服务连接未配置。
