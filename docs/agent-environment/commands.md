# 环境命令

所有应用命令从仓库根目录运行，以根 `package.json` 与 `pnpm-lock.yaml` 为准。Node 要求 `>=22.13.0`，pnpm 要求 `>=9`；项目固定 Node 24.18.0 / pnpm 12.3.4。

## 安装、开发与构建

| 用途 | 命令 | 前置条件与结果 |
| --- | --- | --- |
| 冻结安装 | `pnpm install --frozen-lockfile` | 根 workspace 安装 Vue 应用、共享合同、Supabase CLI 与 Deno 工具；锁文件无漂移 |
| Supabase Local | `pnpm supabase:start` | OrbStack 或兼容 Docker runtime 启动本地 Postgres、Auth、Storage、Realtime、Edge 与 Mailpit |
| 开发 | `pnpm dev` | Supabase Local 已运行；同时启动 Edge Function server 和 Vite PC 应用 `127.0.0.1:8848` |
| 类型检查 | `pnpm typecheck` | 前端 Vue/TypeScript、共享 Zod package、全部 Deno functions |
| 构建 | `pnpm build` | 生成 `frontend/dist/` |

环境变量示例在 `frontend/.env.example` 与 `frontend/.env.development.example`。本机 Supabase URL/publishable key 可从 `pnpm supabase:status` 获取；输出已剔除服务端密钥。

## 首位管理员

Supabase seed 不含公开默认管理员。`pnpm setup:admin` 只接受交互终端和本机 Supabase Local；它请求登录名、显示名与密码恢复邮箱，生成随机初始密码、创建唯一首位 SUPER_ADMIN 并通过 Mailpit 发送密码设置链接。命令不打印初始密码或 service-role key。邮箱冲突、已有普通账号或初始化部分失败时命令拒绝升级账号，可安全重试带受信标记的初始化身份。

## 测试与质量

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 单元 | `pnpm test:unit` | Vitest 与本地 helper 测试 |
| PC 浏览器 mock | `pnpm test:e2e:mock` | Playwright Chromium；隔离服务 fixture，不需要 Supabase 数据库 |
| 本地 PC 浏览器全链路 | `pnpm test:e2e:local` | 本地 Supabase/Mailpit 上真实验证 Auth、字典 CRUD、Realtime、刷新、越权拒绝和退出后的旧 token RLS 拒绝 |
| 当前本地数据库 | `pnpm test:db` | pgTAP/Auth/Edge/Storage/Realtime fixtures；清理测试记录，不重置数据库 |
| 完整空库验收 | `pnpm check:migrations` | 唯一临时 project ID 和动态端口，空库 replay、重复 seed、lint/advisors、pgTAP、服务集成、管理员并发和本地 Auth browser |

`check:migrations` 使用临时工作目录并在结束时停止自己创建的栈；它不访问当前 Supabase 项目。测试产生失败时检查 project ID 与 cleanup 结果，不要停止其他容器。

## Supabase Local 管理

- `pnpm supabase:status`：只显示 project ID、API URL、publishable key。
- `pnpm supabase:stop`：停止当前工作区 project 的服务，保留 Local 数据卷。
- `pnpm supabase:db:reset`：清空当前工作区 Local 数据库，再重放 migration 与 seed。执行前确认 project ID、端口及数据库可丢弃；不要用它重置含用户数据的工作栈，也不要连接远端项目。

完整验证结果写入被忽略的 `.agents/state/evidence/`；交付说明区分静态检查、mock browser、真实 Auth 和空库 replay。
