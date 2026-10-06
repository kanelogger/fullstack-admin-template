# Fullstack Admin Template

面向 PC 浏览器的 Vue 管理后台模板。应用使用 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse、TypeScript、Vite、pnpm 和 Zod；Supabase 提供 PostgreSQL、Auth、Storage、Realtime 与 Edge Functions。项目使用单一根 pnpm workspace，不包含独立 Node/Fastify/MySQL 服务。

后台支持垂直、横向和混合导航。横向菜单超出可用宽度时提供左右滚动控件，并在切换路由后把当前菜单项滚入视口。

## 本地启动

环境要求：Node.js `>=22.13.0`，推荐使用项目锁定的 Node 24.18.0 与 pnpm 12.3.4。macOS 本地 Supabase 使用 OrbStack 或兼容 Docker API 的容器 runtime。

从模板创建新项目副本时，在首次启动 Supabase 前运行：

```sh
pnpm template:select-migrations -- --track baseline
pnpm template:init -- --project-id my-admin --title "My Admin"
```

轨道和项目标识只在首次配置时选择。Docker 状态无法读取，或发现当前/目标 project ID 的本地状态与数据卷时，命令会拒绝修改。已有数据库项目继续使用原 migration 轨道。

```sh
pnpm install
pnpm supabase:start
pnpm setup:admin
pnpm dev
```

`pnpm setup:admin` 仅在本机 Supabase 尚无首位管理员时创建模板管理员。首次初始化默认登录账号为 `admin`，密码为 `admin123456`；邮箱使用本地占位地址 `admin@example.test`。已有本地管理员不会被改名或重设密码，命令会拒绝创建第二个首位管理员；此时使用现有凭据，或通过登录页的密码恢复流程改密。不要为获取默认凭据重置含有数据的本地数据库。

`pnpm dev` 会启动 Supabase Edge Functions 与 Vite，并从当前 Supabase Local 项目读取本地 URL 和 publishable key。查看脱敏后的连接状态运行 `pnpm supabase:status`。数据库重置命令 `pnpm supabase:db:reset` 会清空当前 Supabase Local 数据库，只能用于确认可丢弃的本地项目。

## 验证

```sh
pnpm typecheck
pnpm lint
pnpm check:docs
pnpm check:routes
pnpm build
pnpm test:unit
pnpm test:e2e:mock
pnpm test:e2e:local
pnpm test:db
pnpm check:migrations
pnpm check:migration-upgrades
```

`test:e2e:mock` 使用隔离服务响应，覆盖 PC 浏览器壳、权限路由、核心管理页面、延迟刷新/登出，以及跨标签同账号重登和账号切换。CI 保留重试用于诊断，但 flaky 结果仍使 CI 失败，并上传限期 trace/report。`test:e2e:local` 使用本地 Supabase/Mailpit 验证恢复登录、字典 CRUD、Realtime、刷新、越权和旧 token 的 RLS 拒绝。`check:migrations` 验证历史流空库重放；`check:migration-upgrades` 在历史流和临时基线两边保留数据并应用最近三条真实增量，另外验收固定发布基线，比较权限、账本与完整 schema manifest。

## 架构资料

- [目标架构、约束与验收](docs/diagram/architecture.md)
- [当前架构与接口事实](specs/architecture.md)
- [本地命令与副作用](docs/agent-environment/commands.md)
- [环境服务](docs/agent-environment/services.md)
- [测试约定](rules/testing.md)
