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

设计文档保留技术栈、目录、边界、目标和验收要求。实现与设计的差异、阶段性状态及核实结论在本文件、架构事实和 ADR 中说明，不能通过删减设计文档消除差异。设计文档中的状态行属于原记录；当前 CI 与验收状态以具名运行和对应输入的报告为准。

近期组件迁移及检查记录见 [0007：优先使用官方 shadcn-vue 组件](../adr/0007-standard-shadcn-vue-components.md)，附件上传按钮回归与八场景证据刷新见 [0009：附件上传按钮回归修复与八场景真实验收刷新](../adr/0009-attachment-upload-fix-and-acceptance-refresh.md)，格式检查范围扩展与路由元数据解析解耦见 [0010：格式检查覆盖整个前端源码与路由元数据解析解耦](../adr/0010-format-scope-and-route-metadata-parsing.md)。当前未提交工作区的本地回归与八场景 BrowserSkill 证据已按统一输入摘要刷新；远程 CI 仍未被新提交证明。

## CI 核实记录（2026-10-09）

旧提交 `1f819a09cf8f05487fc6ea3d9a9e59801fad5edc` 的 [运行 37875704153](https://github.com/kanelogger/fullstack-admin-template/actions/runs/37875704153) 和 [运行 37875687467](https://github.com/kanelogger/fullstack-admin-template/actions/runs/37875687467) 有相同的两类失败：

- `quality` 在 `check:test-architecture` 阶段因旧产品/场景/suite 摘要和八场景报告失效而停止；后续检查未执行。
- `visual` 的 14 项比较全部通过，随后清理固定副本时因容器生成的 `node_modules/.bin` 属主权限报 `EACCES`，导致 job 失败。

当前 runner 在支持 UID/GID 的宿主上以宿主身份运行容器，Corepack shim 写入容器临时目录。修改后的固定 Linux 14 项比较与临时目录清理在本机均通过；该修复尚未推送或得到新的远程运行证明。
