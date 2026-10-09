# PC 浏览器管理后台目标架构

> **状态**：已实施，本机完整隔离验收通过；GitHub Actions 等待首次远程运行。
> **状态补充（2026-10-09）**：上行保留原设计记录；当前实施与验收状态见 [`architecture-implementation.md`](./architecture-implementation.md)，远程运行情况见该文档的 CI 核实记录。
> **适用范围**：桌面浏览器端管理后台；不要求移动端布局和移动浏览器验收。
> **当前事实**：以 [`specs/architecture.md`](../../specs/architecture.md)、源码和验证结果为准。
> **架构图**：[`architecture.svg`](./architecture.svg)

## 1. 技术栈

```text
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
├── Type Check
├── Migration Check
└── Browser Test（PC Chromium / Playwright）
```

## 2. 运行拓扑

```text
PC Chromium
  → Vue 3 SPA（Vue Router / Pinia / shadcn-vue / Tailwind CSS v4 / VueUse）
  → feature service
  → Zod contract
  → Supabase JS / RPC / Edge Functions
  → PostgreSQL + Auth + Storage + Realtime
```

构建与验证由根 pnpm workspace 执行。PostgreSQL schema 和初始种子数据由 Supabase migrations 与 `seed.sql` 管理。项目无需独立 Node API 服务或 MySQL。

## 3. 仓库目录

```text
frontend/src/
  app/                 # Vue 根组件
  layouts/             # 后台壳、导航、标签和通知
  router/              # 静态路由、动态 RouteKey 与守卫
  stores/              # session / permission / ui / tabs / notification
  features/            # 按业务域组织页面、组件和服务
  components/          # 跨业务组件与 shadcn-vue 源码
  lib/supabase/        # Supabase JS client
  utils/               # 纯前端通用工具
supabase/
  migrations/          # 数据库结构、RLS、RPC、约束和安全策略
  functions/           # Deno Edge Functions
    _shared/contracts/ # 前后端共用的 @template/contracts Zod 包
  tests/               # pgTAP 数据库权限与行为测试
  seed.sql             # 本地/测试基础数据
scripts/               # 本地开发、首次管理员和验收入口
```

页面不直接发起 Supabase 请求；数据访问经所属业务域的 feature service。

## 4. 前后端契约

- `@template/contracts` 是唯一 Zod schema 与 TypeScript 类型来源，前端和 Deno Edge Functions 从 workspace 同包读取。
- 调用前验证表单和 Edge/RPC 输入；接收服务端返回后验证输出。
- Zod 负责边界格式，Postgres 约束、Edge 校验和 RLS 负责真实数据安全；客户端校验不能替代服务端权限。
- BIGINT 业务 ID 在网络和 JSON 合同中作为十进制字符串，避免 JavaScript `Number` 精度损失。

## 5. 身份、权限与路由

- 唯一登录方式为 `login_name + 密码`。`session-login` Edge Function 负责账号映射、Auth 密码验证与应用 Session 登记；邮箱只用于密码恢复，公共注册关闭。
- 登出等待 `revoke_account_password_session()` 返回已撤销，再清除本地 Auth Session。服务器错误或超时仍会结束本地会话，并显示服务端撤销未确认的提示。
- Supabase Auth 持久化 Session。Session Store 保存当前 Profile 身份；Permission Store 内存保存当前角色码与权限键。用户切换、退出和权限变化会清理旧状态。
- RLS/RPC/Edge Functions 是服务端安全边界。客户端守卫提供导航体验，按钮权限只控制界面展示。
- `current_navigation()` 在服务端按授权过滤菜单；数据库只返回固定 RouteKey。前端静态 registry 决定可装载 Vue 页面，不执行数据库提供的任意路径或组件。
- Auth 状态改变后在回调之外刷新授权与导航。其他标签退出后登录了不同账号时，本页恢复新账号的权限和菜单；尚未完成的旧账号登出不能清除新 Session。页面恢复焦点及定期轮询同步 Session；延迟结果使用身份与操作版本校验，不能覆盖已退出或新账号。
- 首位管理员由 `pnpm setup:admin` 在本机 Supabase Local 初始化，模板默认凭据为 `admin` / `admin123456`，邮箱为 `admin@example.test`。

## 6. 应用壳与业务范围

PC 应用提供登录、主布局、侧栏、顶栏、面包屑、多标签、搜索、通知、403/404/500 错误页、请求加载/空态/错误态和授权提示。布局只负责应用级行为，业务页面归属 `features/`。

当前业务模块包括 Profile、消息中心、用户、角色、菜单、多级部门目录、岗位、字典、系统配置、附件、三类审计日志和 Dashboard。部门层级在 PostgreSQL 中用自引用外键、有效父级检查与环检测维护，前端按祖先路径展示。Dashboard 的待办就是当前用户未读消息，不另建任务域。附件使用私有 Storage；消息变化由 Realtime 推送。

## 7. 状态管理

| Store | 职责 |
| --- | --- |
| `session` | 当前身份、Session 恢复、登录、退出和会话竞态 |
| `permission` | 角色码、权限键、RLS 菜单、动态路由与缓存页 |
| `ui` | 侧栏、布局主题和窗口尺寸 |
| `tabs` | 多标签和页面缓存偏好 |
| `notification` | 当前 Profile 未读数、Realtime 订阅和通知状态 |

Supabase Auth 是持久 Session 唯一来源；权限快照、菜单、路由和按钮能力不长期持久化。服务端权限只有一份事实源，前端 Store 是其当前会话缓存。

## 8. 数据平台边界

- PostgreSQL 结构只通过新的 migration 修改；已应用 migration 不回写、不删除。
- 初始菜单与角色由 seed 建立；重复执行 seed 的结果必须稳定。
- 受保护数据表启用 RLS；复杂多表写入使用事务 RPC 或 Edge Function。
- Storage 使用私有 bucket，数据库元数据与对象读写策略互相约束。
- Auth、用户管理 Edge 操作、关键数据更改写入受限审计表。
- 目标为全新模板，不包含历史 MySQL 数据迁移器。当前 Postgres 代码仍依赖的安全函数、事务行为和排序语义保留在 schema 中。

## 9. 验证层

- `pnpm typecheck`：前端 Vue/TypeScript、共享合同和三个 Deno Edge Functions。
- `pnpm test:unit`：Vitest、Vue 组件、共享合同与脚本测试，包含各业务 Service/Store 的响应、错误、权限和字符串 ID 断言。
- `pnpm check:test-architecture`：CI 结构门禁（白名单、退休登记、逐断言映射结构）。`pnpm check:test-architecture:acceptance`：另要求当前源码匹配的 suite/BrowserSkill 账本。
- `pnpm test:browser`：PC Chromium Session 竞态、权限导航与所有注册路由 × 三布局 × 双主题布局矩阵；成功不保存逐页截图。
- `pnpm test:browser:local`：Mailpit 恢复、PC 浏览器登录、字典类型真实 CRUD、消息 Realtime 收件、刷新恢复、越权路由拒绝、登出及旧 access token 的 RLS 拒绝。
- `pnpm test:visual`：固定 Linux amd64 Playwright 容器比较 14 状态：登录双主题、Dashboard 三布局双主题、用户表格双主题、Profile 表单双主题、角色授权弹窗双主题。
- `pnpm test:visual:update`：仅生成固定副本中的候选 PNG、原图、差异图和 manifest；审阅后 `pnpm test:visual:accept -- --candidate <id>` 才更新正式基线。
- `pnpm test:agent:start/record/verify/retire/cleanup`：固定输入与规则摘要、八个 BrowserSkill 场景 checkpoint 报告、证据完整性与批次删除门槛。
- `pnpm test:db`：本地 Supabase pgTAP、RLS、Edge、Storage、Realtime 和审计集成检查。
- `pnpm check:migrations`：在独立临时 Supabase project/动态端口从空库重放 migrations 和 seed，检查重复 seed、DB lint/advisors、Auth bootstrap 并发、pgTAP、服务集成与本地 Auth 浏览器流，并回收该临时栈。
- GitHub Actions 在 push 与 pull request 上运行测试架构结构检查、冻结安装、类型检查、生产构建、Vitest、PC Chromium、固定容器视觉比较和隔离迁移校验；CI 不生成或接受像素候选，也不把八场景 BrowserSkill 账本当作 PR 门禁。

PC 浏览器最低验收路径固定为：

```text
登录
→ 恢复权限并显示 RLS 过滤的动态菜单
→ 访问授权页面并拒绝未授权页面
→ 执行真实 Supabase 核心 CRUD
→ 接收真实 Realtime 消息
→ 刷新后恢复 Session、菜单与消息状态
→ 退出并验证旧 access token 被 RLS 拒绝
```

该路径由本地 Supabase/Playwright 浏览器测试覆盖；隔离页面测试与独立 pgTAP 测试不能替代它。

## 10. 当前实施边界

测试分层和命令以仓库脚本、`rules/testing.md`、`scripts/test-architecture-rules.json` 与 `scripts/test-architecture-assertions.json` 为准。旧 Smoke 只有逐断言替代映射、相关 BrowserSkill 报告和 verify 全部通过后才退出；缺少真实场景报告时保留原文件。远程 GitHub Actions 的结果只能由对应 workflow run 证明。生产部署、真实远程项目连接与移动端不属于本模板验收范围。

## 11. 原则

- 所有运行依赖都保存在当前仓库；不依赖外部参考模板路径。
- Supabase `service_role` 与 secret key 仅用于本地 Node 脚本或 Edge Function 服务端，不进入前端 bundle。
- 迁移与 seed 可从空库重复执行；验证只操作确认的本地测试栈。
- 真实 Auth、RLS、浏览器和 migration replay 按各自证据分别报告。

## 12. 文档维护与实施记录

本文件是设计文档，原有内容只能增补，不得删减或改写。需要整理实施事实、核实偏差或更新阶段性状态时，新增独立文档，不通过精简本文件替代原设计。

当前实施说明见 [`architecture-implementation.md`](./architecture-implementation.md)；当前接口与实现事实继续见 [`specs/architecture.md`](../../specs/architecture.md)。
