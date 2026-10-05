# Agent 能力探测

适用范围：当前检出工作区。静态来源为根 `package.json`、`pnpm-lock.yaml`、Supabase 配置、Playwright 配置及 `.github/workflows/ci.yml`。本机运行能力写入 `.agents/state/environment.json`，不提交。

| 能力 | 安全探测 | 判断边界 |
| --- | --- | --- |
| Node / pnpm | `node --version`、`pnpm --version` | 版本可见不代表安装、类型检查或构建成功 |
| Volta | `volta --version`、`volta which node`、`volta which pnpm` | 仅证明对应二进制可见；工具版本按根 package manifest |
| OrbStack / Docker | `orb status`、`docker info` | runtime 状态与 CLI 存在分别记录 |
| Supabase CLI / Local | `pnpm supabase:status`，状态输出已脱敏 | CLI、容器、Postgres、Edge 与测试链路分别验证 |
| PC 浏览器 | `pnpm exec playwright --version`、检查安装的 Chromium 后运行 E2E | 版本输出不代表浏览器二进制已安装或页面通过 |
| Git / workspace | `git --version`、`git rev-parse --show-toplevel` | 确认当前检出根；提交规则见 `rules/git.md` |
| CI | 检查 `.github/workflows/ci.yml` 与对应实际 job 结果 | workflow 文件存在不证明远程运行已通过 |
| MCP / Hooks / 发布 | `project.yml#capabilities` | 未配置时记为 `not-applicable`，不推断外部权限 |

状态按证据填写：`unknown` → `installed` / `available` → 必要时 `authenticated`、`authorized` → `healthy`。凭据只检查所需变量是否存在，不输出值。