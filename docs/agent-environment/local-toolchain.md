# 本机开发工具链

项目清单与锁文件固定可复现的 Node / pnpm / Supabase CLI / Deno 工具；工具安装、registry 和 Docker runtime 属于本机开发环境。

## Node 与 pnpm

| 用途 | 版本 | 命令 |
| --- | --- | --- |
| Node | 最低 `>=22.13.0`，Volta 固定 24.18.0 | `node --version`、`volta which node` |
| pnpm | 最低 `>=9`，固定 12.3.4 | `pnpm --version`、`volta which pnpm` |

从仓库根目录执行 `pnpm install`、`pnpm dev`、`pnpm typecheck` 和其他根脚本。workspace 只使用根 `pnpm-lock.yaml`，不在子目录建立第二份 lockfile。

## Registry

npm/pnpm registry 由开发者本机配置提供。安装失败先核实连接和 registry；不要把 registry token 或个人 `.npmrc` 放入仓库。

## OrbStack / Docker

Supabase Local 使用 Docker-compatible API。macOS 上启动 OrbStack 后，用 `orb status` 和 `docker info` 分别确认 runtime 与 Docker API；CLI 存在不代表数据库服务健康。Supabase 启动与清理见 [`services.md`](services.md)。

Supabase 本地 service-role/secret key 只由本机 Node 脚本读取；浏览器环境只接受 publishable key。