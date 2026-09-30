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