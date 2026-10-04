# 本机开发工具链

本项目的 Node 服务使用独立工具链。项目文件固定可复现的版本和依赖；工具安装、registry 选择及 Docker runtime 属于开发者本机设置，不写入项目凭据。

## JavaScript 与 Node

| 用途 | 项目配置 | 命令 |
| --- | --- | --- |
| Node 版本管理 | `frontend/package.json`、`backend/package.json` 的 `volta` 字段 | `node --version`、`volta which node` |
| 前端包管理 | pnpm 12.3.4；前端安装、类型检查和构建都用 pnpm | 在 `frontend/` 执行 `pnpm install`、`pnpm dev`、`pnpm typecheck`、`pnpm build` |
| 旧后端包管理 | npm 12.0.2 | 在 `backend/` 执行 `npm install`、`npm run dev`、`npm run typecheck` |

目前项目固定 Node 24.18.0；两份包清单同时声明最低 Node `>=22.13.0`。安装 Volta 后可用 `volta install node@24.18.0` 和 `volta install pnpm@12.3.4` 准备本机工具。进入前后端目录时，Volta 会按最近的 `package.json` 选择版本；非 Volta 用户可使用满足 `engines` 的 Node 及满足前端 `engines.pnpm` 的 pnpm。

不要在两个目录间混用安装器：前端依赖由 pnpm 和 `frontend/pnpm-lock.yaml` 管；旧 Fastify 后端依赖由 npm 管。除非后端引入 npm 锁文件的专门任务，不要同时用两个工具安装同一份后端依赖。

## npm registry 与 yrm

yrm 管理开发者机器上的 npm registry 选择，不是本项目运行依赖。当前参考环境使用 yrm 1.0.6；该版本多年未发布，内置镜像列表可能过期。使用前先检查来源，再验证可用性：

```bash
yrm ls
yrm test <registry-name>
yrm use <registry-name>
npm config get registry
pnpm config get registry
```

`yrm use` 会改变用户级 registry 设置，影响本机 npm/pnpm 后续联网请求。不要把 registry URL、认证 token 或个人 `.npmrc` 提交到仓库；不要使用旧列表中仍为 HTTP 的镜像。完成切换后用 `yrm use npm` 恢复官方 npm registry，或使用组织批准的 HTTPS 镜像。

## OrbStack 与 Docker

Supabase 本地服务通过 Docker-compatible API 启动。macOS 开发机安装并启动 OrbStack 后，在仓库根目录确认 Docker CLI 能连接 runtime：

```bash
orb status
docker info
```

若 OrbStack 尚未运行，可从 macOS 应用菜单启动；安装了 CLI 时也可使用 `orbctl start`。Docker CLI 可用不代表 Supabase 容器已启动。Supabase Local 服务的端口、启动和停止步骤见 [服务说明](services.md#supabase-local)。

不要提交 Docker socket、OrbStack 用户数据目录、私有镜像凭据或本机路径。Supabase 本地密钥只用于本机开发；部署密钥和 `service_role` 不得放进 `VITE_*` 变量。

## 本机与项目基线

提交的版本固定可重放的工具链参考；机器上当前是否已安装、OrbStack 是否运行、registry 是否可用，都必须执行命令重新探测。静态约定见 [`project.yml`](../../project.yml)，运行探测见 [`capabilities.md`](capabilities.md)。
