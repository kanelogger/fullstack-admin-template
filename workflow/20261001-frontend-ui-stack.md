# 前端 UI 技术栈迁移方案

## 目标与证据

用户指定的 Application 栈包含 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse。此记录形成时，`frontend/package.json` 已包含除 shadcn-vue 以外的框架与工具；Vite 已通过 `@tailwindcss/vite` 使用 Tailwind v4，旧页面和应用壳仍大量使用 Element Plus。后续渐进迁移进度以 `tasks/20261001-supabase-architecture-migration.md` 为准；目前应用壳与多个业务切片已完成迁移。

## 本轮边界

`docs/diagram/template.md` 允许 UI 渐进迁移并在过渡期保留 Element Plus，且阶段一保留 Fastify/MySQL 作为运行基线。因此本轮建立 shadcn-vue、Tailwind v4 的组件/主题基础，并迁移登录与首页；数据请求、认证、路由和动态权限行为保持现有实现。Supabase 迁移属于后续阶段。

## 验收与遗留

已建立 shadcn-vue 配置、语义主题和 Button/Input/Label/Card/Badge 组件；登录与首页已迁移并保留原来的登录、动态路由、记住登录和仪表盘请求行为。`pnpm typecheck` 与 `pnpm build` 均通过；隔离 Chrome 会话真实呈现了登录页和可访问控件。未向后端提交登录；应用壳、其余管理页及 PureAdmin 派生工具仍待后续模块迁移。

Tailwind 工具类最初被旧的未分层 `reset.scss` 覆盖；已将其归入 Tailwind `base` 层，并把 Tailwind 入口前置。最终浏览器截图确认桌面登录页的输入图标、内边距与按钮样式正常；窄屏布局未单独验证。登录接口未提交；本地后端未运行时 Vite 曾记录 `/refresh-token` 代理连接被拒绝。
