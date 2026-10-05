# Fullstack Admin Template

面向 PC 浏览器的 Vue 管理后台模板。应用使用 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse、TypeScript、Vite、pnpm 和 Zod；Supabase 提供 PostgreSQL、Auth、Storage、Realtime 与 Edge Functions。项目使用单一根 pnpm workspace，不包含独立 Node/Fastify/MySQL 服务。

后台支持垂直、横向和混合导航。横向菜单超出可用宽度时提供左右滚动控件，并在切换路由后把当前菜单项滚入视口。

## 本地启动

环境要求：Node.js `>=22.13.0`，推荐使用项目锁定的 Node 24.18.0 与 pnpm 12.3.4。macOS 本地 Supabase 使用 OrbStack 或兼容 Docker API 的容器 runtime。

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
pnpm check:routes
pnpm build
pnpm test:unit
pnpm test:e2e:mock
pnpm test:e2e:local
pnpm test:db
pnpm check:migrations
```

`test:e2e:mock` 使用隔离服务响应，覆盖 PC 浏览器壳、权限路由、核心管理页面、会话竞态，以及另一标签切换账号时保留新 Session。`test:e2e:local` 使用本地 Supabase/Mailpit，在真实 PC 浏览器完成恢复与登录、字典类型 CRUD、Realtime 收件、刷新恢复、COMMON_USER 越权拒绝、登出和旧 access token 的 RLS 拒绝。`test:db` 在当前 Supabase Local 项目上运行 pgTAP 和 Auth、Edge、Storage、Realtime 集成 fixture。`check:migrations` 在临时独立 Supabase 项目中从空库重放所有迁移和 seed，创建并实际登录默认管理员，再验证数据库约束、服务集成与浏览器链路，最后清理它自己的临时容器。

## 架构资料

- [目标架构、约束与验收](docs/diagram/architecture.md)
- [当前架构与接口事实](specs/architecture.md)
- [本地命令与副作用](docs/agent-environment/commands.md)
- [环境服务](docs/agent-environment/services.md)
- [测试约定](rules/testing.md)
