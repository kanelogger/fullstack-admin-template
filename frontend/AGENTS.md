# 前端工作区

本目录是根 pnpm workspace 的 Vue 3 PC 浏览器应用包。依赖安装、运行和验证从仓库根目录执行，使用 pnpm 与根 `pnpm-lock.yaml`。

## 结构边界

- `src/app/`：Vue 应用根组件。
- `src/layouts/`：后台布局、侧栏、顶栏、多标签和通知。
- `src/router/`：公开错误路由、动态路由和守卫。
- `src/stores/`：`session`、`permission`、`ui`、`tabs`、`notification` Pinia 状态。
- `src/features/`：按认证、用户、角色、菜单、组织、字典、配置、消息、附件、审计、Dashboard、Profile 等业务域组织页面和服务。
- `src/components/`：跨业务共享组件；shadcn-vue 组件源码位于 `src/components/ui/`。
- `src/lib/supabase/`：Supabase JS client。
- `@template/contracts`：位于 `supabase/functions/_shared/contracts` 的 workspace 包，作为前端与 Edge Functions 唯一 Zod 契约源。

业务页面不得直接调用 Supabase client；数据访问经 feature service，输入/输出按共享 Zod 契约验证。授权由权限 Store、路由守卫及服务端 RLS 共同执行，不能依赖隐藏按钮。

## Auth 与 Supabase

- 登录只接受 `login_name + 密码`；浏览器通过 `session-login` Edge Function 获取 Session，不直接执行密码登录。
- Supabase Session 只由 Auth client 持久化。业务资料存在 `profiles`；权限在 Pinia permission Store 的内存快照中；Session Store 不持久化角色/权限。
- Auth 状态变更后在回调之外刷新权限和导航；登出、账号切换时清理标签、路由、权限和通知。临时网络错误保留已验证的 UI 状态，RLS 仍在服务端拒绝过期权限。
- `.env.example` 和 `.env.development.example` 只包含本地 URL、端口和 publishable key 样例；严禁将 service-role/secret key 放入 `VITE_*`。

## 命令

从仓库根目录运行 `pnpm dev`、`pnpm build`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:e2e:mock`、`pnpm test:e2e:local`、`pnpm test:db`。完整 migration replay 与真实本地浏览器链路使用 `pnpm check:migrations`。仅面向 PC Chromium 验收，不定义移动端适配要求。
