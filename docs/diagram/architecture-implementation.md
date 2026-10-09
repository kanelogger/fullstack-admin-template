# PC 浏览器管理后台实施说明

> **实施状态**：核心分层已实现；验收状态以对应输入版本的报告与远程 workflow run 为准。
> **适用范围**：PC Chromium 管理后台。
> **设计文档**：[`architecture.md`](./architecture.md)，保留原设计内容，只允许增补。
> **当前实现事实**：[`specs/architecture.md`](../../specs/architecture.md)、源码与验证结果。
> **架构图**：[`architecture.svg`](./architecture.svg)

## 运行分层

```text
PC Chromium → Vue SPA → feature service → 共享 Zod contract
             → Supabase JS / RPC / Edge → PostgreSQL / Auth / Storage / Realtime
```

## 目标与约束

- 页面负责交互，feature service 负责数据访问；共享合同位于 `@template/contracts`。
- PostgreSQL RLS、RPC 与 Edge Functions 构成服务端权限边界；动态菜单只装载固定 RouteKey。
- Supabase Auth 持久化 Session，异步身份、授权和通知结果按 Session 与操作版本归属。
- UI 优先组合官方 shadcn-vue 组件与 Tailwind v4 tokens，弹窗、菜单、确认和通知复用库行为。
- 新项目首次启动前选择 migration 轨道；已有数据库保持原轨道，已应用 migration 不改写。
- 验收包含真实登录、授权菜单、CRUD、Realtime、刷新恢复和退出后的 RLS 拒绝。
- 像素基线需审阅候选后接受；历史 BrowserSkill 报告仅在输入摘要匹配时复用。

目录、业务范围、双轨迁移、CI 步骤与验证状态见[架构事实](../../specs/architecture.md)；命令与副作用见[环境命令](../agent-environment/commands.md)，验收门槛见[测试约定](../../rules/testing.md)。

## 与设计文档的关系

设计文档说明目标；当前目录、接口和行为以 specs/architecture.md 与源码为准。验收结果只对输入摘要匹配的运行报告有效。
