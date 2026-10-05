# Agent 环境资料

根目录 [`AI_ENVIRONMENT.md`](../../AI_ENVIRONMENT.md) 按任务路由，本目录保存 PC Supabase workspace 的环境与命令事实。

| 任务 | 资料 |
| --- | --- |
| 命令、前置条件和副作用 | [`commands.md`](commands.md)、根 [`project.yml`](../../project.yml) |
| Local Supabase/Vite 服务 | [`services.md`](services.md) |
| 工具与浏览器能力探测 | [`capabilities.md`](capabilities.md) |
| 网络、worktree 和本地状态 | [`network-filesystem.md`](network-filesystem.md) |
| Local/CI 差异 | [`ci-parity.md`](ci-parity.md) |
| Node、pnpm 与 Docker | [`local-toolchain.md`](local-toolchain.md) |

维护时把静态配置、实际运行结果、权限和数据副作用分别记录。未执行的 CI 或真实 Auth 场景不得标为已通过。