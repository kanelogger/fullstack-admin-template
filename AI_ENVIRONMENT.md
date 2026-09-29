# Agent 环境索引

按任务读取下表中的资料。这里只保存项目约束、事实来源和探测方法；本机版本、依赖安装状态、端口、锁和会话快照放在被忽略的 `.agents/state/`，换工作区后重新探测。

| 任务 | 按需入口 |
| --- | --- |
| 执行、修改或注册命令 | [命令约定](docs/agent-environment/commands.md)、[project.yml](project.yml) |
| 启动或排查前后端、数据库 | [服务说明](docs/agent-environment/services.md) |
| 确认工具、Skill、Connector 和权限 | [能力探测](docs/agent-environment/capabilities.md) |
| 从子目录启动、worktree、并发状态、网络或文件访问 | [网络与文件系统](docs/agent-environment/network-filesystem.md) |
| CI、发布和环境差异 | [环境对齐](docs/agent-environment/ci-parity.md) |
| 恢复目标、验收条件和阻塞 | [任务记录](tasks/README.md)、[工作流](workflow/README.md) |
| 创建、重构或审计 Agent 规则 | [agents-maintenance](.agents/skills/agents-maintenance/SKILL.md) |

## 事实源

- 命令实现与运行时约束：[前端 package.json](frontend/package.json)、[后端 package.json](backend/package.json)。`project.yml` 只登记执行入口、工作目录和前置条件；冲突时先核实包清单并更新索引。
- 运行行为：源码、配置、数据库 Schema 和行为验证；跨模块契约见 [architecture.md](specs/architecture.md)。
- 决策原因：[docs/adr/](docs/adr/)。时间较新不能单独推翻更强的源码或验证证据。
- 权限与敏感数据：[安全规则](rules/security.md)。仓库声明能力不代表当前会话获得该能力或授权。

## 有效性

适用范围为本仓库；负责人为项目维护者。静态结构最近核实于 **2026-09-29**，证据为 `project.yml` 所引用的包清单、配置和规则。工具链、依赖、工作区、权限、服务或 CI 配置变化时重新核实对应章节。

未知写 `unknown`，不适用写 `not-applicable`。运行态记录至少包含 `scope`、`owner`、`observed`、`evidence`、`verified_at`、`refresh_when`、`status`；无有效探测时不能从旧会话继承 `healthy`。

当前没有测试/E2E、CI、部署、MCP 或 Hook 入口。这些是尚未配置的能力；新增时同步登记来源、权限、副作用和验证方式。
