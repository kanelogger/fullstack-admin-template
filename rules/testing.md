# 测试约定

项目以 PC Chromium 浏览器为目标。类型检查、构建、单元测试、隔离浏览器测试和 Supabase Local 集成测试是不同证据；不能把某一层的通过描述为其他层已验证。

## 常用入口

- `pnpm typecheck`：检查 Vue/TypeScript、共享 Zod 合同与三个 Deno Edge Function 入口。
- `pnpm lint`：检查 Vue、TypeScript、共享合同、仓库脚本与 Deno Edge Functions。
- `pnpm check:routes`：核对 RouteKey 合同、页面注册、唯一默认路径、有效权限键及导入文件存在且不被 Git 忽略；CI 还要求导入文件已跟踪。
- `pnpm build`：生成生产前端包。
- `pnpm test:unit`：运行前端逻辑、合同、Edge helper 和本地脚本测试。
- `pnpm test:e2e:mock`：用隔离响应启动 Vite 与 PC Chromium，验证路由、主要页面、授权 UI、延迟 Session 刷新/退出竞态，以及另一标签切换账号时保留新 Session。
- `pnpm test:e2e:local`：连接本机 Supabase/Mailpit，由真实 PC Chromium 验证恢复、登录、字典 CRUD、Realtime 收件、刷新恢复、COMMON_USER 越权拒绝、登出与旧 token 的 RLS 拒绝。
- `pnpm test:db`：在已启动的当前 Supabase Local 数据库运行 pgTAP，并创建/清理 Auth、RLS、Storage、Realtime 与 Edge 集成数据；它不会重建数据库。
- `pnpm check:migrations`：复制 Supabase 配置到临时目录，用唯一 project ID 和动态端口从空库重放 migrations/seed、二次执行 seed、运行 DB lint/advisors、pgTAP、Edge/Storage/Auth 检查、管理员 bootstrap 并发测试和本地 Auth 浏览器流程。脚本结束时只停止并删除自己创建的临时 Supabase 项目。

PC 浏览器最低验收路径固定为“登录 → 动态菜单 → 授权访问/拒绝越权 → 真实核心 CRUD → Realtime 收件 → 刷新恢复 → 登出并验证服务端拒绝旧 access token”。该路径由本地 Supabase 的 `test:e2e:local` 覆盖；mock E2E 和分层 pgTAP 测试不能替代该门槛。

## 安全与清理

- 本地测试不得连接远程 Supabase，不得输出 service-role/secret key。浏览器测试只使用 publishable key。
- `pnpm test:db` 会写入当前本地数据库的合成 fixture 并在结束时清理；开始前核对 Supabase Local project/端口归属和状态。
- `pnpm check:migrations` 会启动并销毁临时容器与数据卷，保留当前开发栈不变。失败时确认错误输出中的 project ID 和清理结果；不得停止无关容器。
- 测试生成的用户、Profile、消息、对象、邮件和进程必须清理。不得把真实业务数据写入 `supabase/seed.sql`。
- 行为、路由或 Supabase 权限改变时更新相应 Vitest/pgTAP/Playwright 验证；全套跑完后继续改代码，必须重跑受影响检查。

## 结果描述

明确记录命令、退出码和运行范围。指出跳过或未覆盖的场景；类型检查与构建不代表 Auth、RLS 或浏览器链路通过，mock E2E 也不代表真实网络集成已通过。
