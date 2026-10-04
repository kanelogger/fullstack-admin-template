# 全栈技术架构

> 配图：[`architecture.svg`](./architecture.svg)

## 一张图读懂

```
          ┌──────────────────────────────────────┐
          │ Build & Language · 构建与语言        │
          │ TypeScript / Vite / pnpm             │
          └──────────────────────────────────────┘
                             │
                             │ 构建
┌────────────────────────────────────────────────────────────┐
│ Application · 前端应用                                     │
│                                                            │
│ Vue 3 SPA · 应用外壳 · Composition API                     │
│ Vue Router · Pinia · shadcn-vue · Tailwind CSS v4 · VueUse │
└────────────────────────────────────────────────────────────┘
                             │
                             │ 类型安全的 API 调用
┌────────────────────────────────────────────────────────────┐
│ Contract · Zod · Shared Schema / Runtime Validation        │
└────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────────────────────────────────────┐
│ Backend Platform · Supabase                                │
│ PostgreSQL · Auth · Storage · Realtime · Edge Functions    │
└────────────────────────────────────────────────────────────┘
                              ▲ Realtime 推送（WebSocket 反向回推前端）
                   ▲                                       ▲
           迁移 / 浏览器测试                           驱动开发
┌────────────────────────────────────┐  ┌────────────────────────────────────┐
│ Quality · 质量保障                 │  │ AI Engineering · AI 工程           │
│ Vitest / Type Check / 迁移校验     │  │ Codex / OMP / Pi / Herdr 代理      │
│ Browser Test · Playwright 工具链   │  │ AGENTS.md · Skills 技能包          │
└────────────────────────────────────┘  └────────────────────────────────────┘
```

自上而下：构建工具链产出前端应用，前端经由 Zod 契约层调用 Supabase 后端平台。全部调用走同一个契约收口。

## 分层清单

```
Application
├── Vue 3
├── Vue Router
├── Pinia
├── shadcn-vue
├── Tailwind CSS v4
└── VueUse

Build & Language
├── TypeScript
├── Vite
└── pnpm

Backend Platform
└── Supabase
    ├── PostgreSQL
    ├── Auth
    ├── Storage
    ├── Realtime
    └── Edge Functions

Contract
└── Zod

Quality
├── Vitest
├── Ego lite / BrowserSkill / Playwright
├── Type Check
├── Migration Check
└── Browser Test

AI Engineering
├── Codex / OMP / Pi / Herdr
├── AGENTS.md
└── Skills
```

## 三条关键链路

**调用链（主链路）**：Vue 3 SPA → Zod 校验/类型收口 → Supabase 各服务。读写同路；提交侧载荷先过运行时校验，非法数据进不了后端。契约层的改动波及面最大——Schema、前端调用点、后端实现必须同步。

**认证链路**：应用登录入口只提供 `login_name` + 密码。迁移期账号由 Edge Function 映射到 Supabase Auth 已验证邮箱并验证密码，再将 Auth Session 登记到私有白名单；浏览器不得直接调用 Auth 密码登录。RLS 与 Fastify 旧 Token bridge 同时要求 JWT `amr=password` 和已登记的 Session。邮箱只用于密码重置；本地 Auth 全局及 email provider 公共注册均关闭。应用不提供短信、邮箱验证码/魔法链接登录、OAuth、SSO 或 Passkey。底层 recovery OTP 保留用于密码重置，但不能访问业务资料或换取旧 JWT；服务端私有表保存重置请求前的 Auth 密码哈希快照，只有哈希确实变化后，才可清除强制重置标记；完成后立即退出。
