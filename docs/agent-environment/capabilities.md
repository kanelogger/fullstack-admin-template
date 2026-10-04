# Agent 能力探测

适用范围：当前检出工作区。静态来源核实于 2026-10-01，负责人：项目维护者。工具链、依赖、Agent 宿主或权限变化时刷新；本机探测结果写入 `.agents/state/environment.json`，不提交。

| 能力 | 来源与安全探测 | 可用条件 |
| --- | --- | --- |
| Node / 包管理器 | `node --version`、`pnpm --version`、`npm --version`；约束见前后端包清单 | 版本符合配置；仅查版本不证明依赖、构建或服务可用 |
| Volta | `volta --version`、`volta which node`、`volta which pnpm`、`volta which npm` | 只能证明对应二进制可见；项目版本以最近的 `package.json#volta` 为准 |
| yrm registry 工具 | `yrm --version`、`yrm current` | registry 切换会改用户配置；不要把本机 registry 或 URL 当成仓库事实 |
| pyenv / Conda | `pyenv --version`、`pyenv version`、`conda --version`、`conda env list` | 当前解释器和 conda 环境名可探测；不据此推断 CUDA/MPS 或框架可用 |
| OrbStack / Docker | `orb status`、`docker info` | OrbStack 状态与 Docker API 可达性分别记录；CLI 存在不证明容器 runtime 健康 |
| Supabase CLI / Local 栈 | 在 `frontend/` 执行 `./node_modules/.bin/supabase --version`、`supabase status`；运行状态检查时屏蔽本地 key 输出 | CLI 版本、config 解析、容器健康、数据库 lint 和 migration 测试分别验证；CLI 可执行不代表 Local 栈健康 |
| Git / 工作区 | `git --version`、`git rev-parse --show-toplevel` | 确认当前检出根；提交规则见 `rules/git.md` |
| 前后端依赖 | 在对应目录运行 `pnpm list --depth 0` / `npm ls --depth=0`，随后执行相关脚本 | `node_modules` 存在不代表安装完整；脚本必须真实成功 |
| MySQL 客户端 | `mysql --version` | 客户端存在不代表服务健康；连接检查见 [服务说明](services.md) |
| 浏览器 | 以当前宿主暴露的浏览器工具与实际打开页面结果为准 | 未暴露工具时状态为 `unknown`，不能声称已经验证 UI |
| 规则维护 Skill | [本地入口](../../.agents/skills/agents-maintenance/SKILL.md)及其 references | 仅规则维护任务加载；文件存在不证明宿主自动发现成功 |
| 外部 Skill 来源 | [skills.sources.json](../../.agents/skills.sources.json) | 当前列表为空；安装外部 Skill 前固定版本并审查读写/网络权限 |
| MCP / Hook / 发布连接 | `project.yml#capabilities` | 当前未配置（`not-applicable`）；不得据模板猜测工具或权限 |

状态按证据填写：`unknown` → `installed` / `available` → 必要时 `authenticated`、`authorized` → `healthy`。执行能力仅在前置条件和本次授权都满足时视为 `healthy`；失败标记 `unavailable`，策略禁止标记 `blocked-by-policy`。允许先做无副作用探测来消除 `unknown`。

`.agents/` 是本项目的维护目录。每种 Agent 按自己的发现规则加载它；未自动发现时，从根 `AGENTS.md` 的链接显式读取入口，不复制多份正文。普通开发任务不加载维护 Skill，维护任务先读入口，再按风险加载对应 reference。

凭据只检查所需变量是否存在，不输出值。不自动创建外部连接、安装全局 Skill 或修改用户级 Agent 配置。
