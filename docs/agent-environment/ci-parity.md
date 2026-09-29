# 本地、CI 与发布环境对齐

| 维度 | local | CI | release |
| --- | --- | --- | --- |
| 入口 | `project.yml`、前后端 `package.json`、`.env.example` | `unknown`（仓库没有 workflow） | `not-applicable`（仓库没有部署配置） |
| Node.js | `frontend/package.json#engines.node` | `unknown` | `not-applicable` |
| 前端包管理器 | `frontend/package.json#engines.pnpm` | `unknown` | `not-applicable` |
| 后端包管理器 | 当前流程使用 npm；包清单未锁定工具 | `unknown` | `not-applicable` |
| 数据库 | MySQL 8.0+；默认地址来自后端环境变量 | `unknown` | `not-applicable` |
| 命令 | [project.yml](../../project.yml) 与 [commands.md](commands.md) | `unknown` | `not-applicable` |
| 权限 | 仓库内可逆编辑按任务授权 | `unknown` | 发布与生产写入需要人工批准 |
| 网络 | 安装依赖需要 registry；运行链路访问本机服务 | `unknown` | `not-applicable` |

## 当前差异

- 当前没有 CI 配置，不能声称 local 与 CI 已对齐。引入 workflow 后登记 OS、架构、运行时、锁文件、服务、命令、权限、网络、缓存和工件。
- 当前没有发布或部署配置，不能推断生产命令、生产数据库或发布凭据；发布任务先补充配置和人工门禁。
- 前端 `dev`、`build` 脚本使用 POSIX `NODE_OPTIONS=...` 写法。Windows 上使用 Git Bash 或等价 shell，不能把 cmd 能否解析该脚本写成已验证事实。
- 当前前后端没有锁文件；执行安装时可能生成 `frontend/pnpm-lock.yaml` 或 `backend/package-lock.json`。生成的锁文件属于依赖变更，须按任务范围审查后决定是否入库。

每项差异记录证据、接受理由和刷新触发条件。没有可运行入口时，把状态记为 `unknown` 或 `not-applicable`，不以目录名称或模板默认值推断能力。
