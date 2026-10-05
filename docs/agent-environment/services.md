# 环境服务

## Supabase Local

- 前置条件：OrbStack 或兼容 Docker API 的 runtime 正在运行，根 workspace 依赖已安装。
- 启动/状态/停止：在仓库根目录执行 `pnpm supabase:start`、`pnpm supabase:status`、`pnpm supabase:stop`。
- Local API 默认在 `127.0.0.1:54321`，Postgres 在 54322，Studio 在 54323，Mailpit 在 54324；Edge Functions 与其他本地服务端口由 `supabase/config.toml` 管理。
- `pnpm supabase:stop` 保留数据库卷。`pnpm supabase:db:reset` 会清空当前 Local 数据库；执行前确认项目和数据归属。
- Auth 邮件仅投递到本地 Mailpit，不会向真实用户发信。首次管理员使用本地默认凭据，不需要邮件设置密码；密码恢复邮件可在 `http://127.0.0.1:54324` 查看。

CLI 已安装不证明 Docker runtime 或数据库健康；用脱敏 `pnpm supabase:status` 及具体集成验证确认。

## 开发进程

| 服务 | 命令 | 地址 | 说明 |
| --- | --- | --- | --- |
| Edge Functions | `pnpm functions:serve` | Local Supabase API 下的 `/functions/v1/*` | `pnpm dev` 会作为开发子进程启动 |
| Vue/Vite | `pnpm dev` | `http://127.0.0.1:8848` | PC 浏览器管理后台；退出命令停止本次子进程 |

开发脚本从 Supabase Local 状态读取 URL 与 publishable key，并只注入子进程；service-role key 不进入浏览器环境。

## 隔离迁移校验栈

`pnpm check:migrations` 为 Supabase CLI 生成唯一 project ID，复制配置与 migrations 到临时目录并分配动态端口。脚本停止并删除该项目创建的容器/数据卷，不连接或停止当前开发栈。确认失败输出中是否有 cleanup error 后再处理遗留的该唯一项目。
