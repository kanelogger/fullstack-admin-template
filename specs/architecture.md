# 当前架构与接口事实

- 最近核实：2026-10-09。静态事实以本文件、`package.json`、`supabase/config.toml`、SQL migrations、共享契约和验证脚本为准；实际行为以代码和测试证据为准。
- 目标用户界面：PC 浏览器；移动端适配与验收不属于模板目标。

## Workspace 与目录

- 根 pnpm workspace 包含 `frontend/` Vue SPA 与 `supabase/functions/_shared/contracts` 的 `@template/contracts` Zod workspace 包。根 `pnpm-lock.yaml` 锁定应用、Supabase CLI、Deno 和共享契约依赖。
- 前端主要目录：`src/app`、`src/layouts`、`src/router`、`src/stores`、`src/features`、`src/components`、`src/lib`。`features` 按业务域同时拥有页面、业务组件与 Supabase feature service；页面不直接发起 Supabase 查询。
- Pinia Store 分为 `session`、`permission`、`ui`、`tabs` 与 `notification`。Supabase Auth 管 Session 持久化；用户资料在 Session Store 内存态；角色码和权限键只在 Permission Store 内存态；标签和 UI 偏好与身份状态隔离。
- Supabase migrations/seed 位于仓库根 `supabase/`。Edge Functions 使用 Deno，`session-login`、`password-reset` 与 `user-management` 入口复用共享合同。

## Auth 与权限

- 唯一应用登录入口为 `login_name + 密码`。`session-login` Edge Function 在服务端映射已验证邮箱，建立 Auth Session 并登记允许访问业务数据的 Session。邮箱仅用于密码恢复；底层 recovery Session 不能读取业务数据。
- 首位管理员通过根命令 `pnpm setup:admin` 建立。仅限当前 Supabase Local；模板默认登录账号为 `admin`、密码为 `admin123456`、邮箱为 `admin@example.test`。公共注册关闭。
- `profiles.auth_user_id` 必填并引用 `auth.users.id`；业务实体 ID 为 PostgreSQL BIGINT，在 Zod API 合同中以十进制字符串传输。
- RLS 是数据安全边界。`current_profile()` 返回本人资料、角色码和权限键；`current_navigation()` 按服务端授权返回菜单。浏览器只按固定 RouteKey registry 装载动态页面。路由守卫和按钮权限提供 UX 控制，不能替代 RLS/Edge/RPC 权限检查。
- 角色菜单授权复用菜单路由的既有 permission key，不创建第二套 role-menu 关系。按钮权限由角色权限集合及服务端授权函数管理。
- Auth Session 以 `auth_user_id + JWT session_id` 唯一标识；`session_id` 仅用于客户端旧结果归属判断，服务端仍验证 JWT 和已登记应用 Session。Auth 协调器维护操作版本与待登出归属；Session Store 保存身份，Permission Store 保存授权快照。
- Auth 的 `SIGNED_IN`、`TOKEN_REFRESHED`、`USER_UPDATED` 在回调之后触发权限与导航刷新；焦点恢复和 60 秒轮询刷新会话。动态路由只在捕获的 `auth_user_id + session_id` 和操作版本仍匹配时安装。资料接口明确拒绝 Session 时按该 Session 清理本地状态；临时错误保留最后验证的 UI 状态。应用发起的 `setSession` / `signOut` 由跨标签 Web Lock 串行化；退出使用捕获 Session 的 token 撤销，仅在持久 Session ID 仍匹配时清本地 Auth Session。通知请求绑定 Profile 接收者、Session ID 检查和订阅版本。

## PC 导航

- 后台提供垂直、横向和混合三种 PC 导航布局。横向与混合布局的顶部菜单可左右滚动；内容超出可用宽度时显示方向控件，路由切换和窗口尺寸变化后将当前路由菜单项完整滚入视口。
- 当前横向导航的验收测试覆盖所有注册页面，并检查菜单目标完整可见、滚动控件可操作以及页面没有横向溢出。

## 数据功能

- 用户、角色、菜单、部门、岗位、字典、配置、Profile、消息、附件、审计与 Dashboard 均通过 Supabase RPC/表策略/Edge Functions。
- 部门通过可空 `departments.parent_id` 形成多级树；`department_read_model` 返回字符串父 ID，页面显示祖先路径并提供上级选择。数据库在 RLS 写权限之上校验上级有效性、禁止循环并阻止软删除仍有活动子部门的父级；旧部门和 Profile 部门引用保持不变。
- Dashboard 的待办是当前用户未读消息，不另建任务实体。消息的列表、详情、已读和 Realtime 事件受收件人 RLS 约束。
- 附件保存在私有 `admin-attachments` Storage bucket，元数据和对象权限分开控制；引用状态与 MIME/扩展名、大小受到数据库和 Storage 限制。
- 历史 MySQL 导入功能不属于新模板支持范围。完整历史轨有 7 条 migration 定义 `import_legacy_*` 函数（消息、用户、菜单、组织、字典配置、附件和审计），后续 cleanup 撤销这些入口；baseline 轨不包含历史导入 migration。历史 migration 保持不可变；新项目首次启动前执行 `pnpm template:select-migrations -- --track baseline`，已有数据库不可换轨、本地状态无法核实时拒绝修改；该轨道使用截止版本 `20261005084413` 的固定基线 `supabase/baselines/20261005084413/`。之后的增量 migration 同时镜像到两条轨道，升级验收会保留数据并用 `migration up`，不会重置升级中的数据库。

## 本地运行与质量入口

- Node `>=22.13.0`、pnpm `>=9`，项目固定 Node 24.18.0 / pnpm 12.3.4；Postgres Local major version 为 17。
- `pnpm supabase:start/status/stop` 管理本地栈；`pnpm dev` 同时启动 Edge Functions 与 Vite (`127.0.0.1:8848`)。Auth 邮件由本地 Mailpit 捕获。
- `pnpm check:test-architecture` 是 CI 结构门禁：锁定六类 Playwright spec，校验逐断言映射结构与替代引用是否存在；不要求已提交 BrowserSkill/suite 摘要匹配当前源码。`pnpm check:test-architecture:acceptance` 才要求账本中的 suite 通过记录与八场景报告匹配当前产品/场景摘要。`pnpm test:unit` 聚合 Vitest、jsdom Vue 组件、共享合同和脚本测试；`pnpm test:browser` 覆盖 Session 竞态、权限导航和完整路由布局矩阵；`pnpm test:browser:local` 覆盖本地 Supabase Auth/RLS/CRUD/Realtime 链路；`pnpm test:visual` 比较固定容器中的 14 个像素状态。Browser 与 Local Auth Playwright 产物分别写入 `test-results/{browser,browser-local}/` 和 `playwright-report/{browser,browser-local}/`。
- BrowserSkill 的八个场景使用固定源码副本、冻结锁安装和版本化 SHA-256 输入摘要；报告必须同时匹配产品摘要与场景执行摘要，后者覆盖验收 runner、账号/fixture 准备和启动配置。该门槛由 acceptance / `test:agent:verify` / `test:agent:retire` 执行，不作为普通 PR CI 阻塞条件。仅显式登记的验收管理输入与逐断言清单可单独报告 drift。报告逐 checkpoint 记录状态、观察与证据，并校验 debug 捕获的 session、应用 origin 和时间范围与报告匹配。`test:agent:retire` 按登记批次原子删除，并复核每条原始断言的源码指纹。
- BrowserSkill、`check:migrations` 与 `check:migration-upgrades` 创建的隔离栈，只有在 Supabase CLI stop 成功且 Docker 中精确 project label 下的容器、卷和网络均已消失后才记录清理成功。资源查询失败或仍有资源时清理失败，保留恢复目录和诊断信息。
- Visual 更新只在固定副本中生成候选、原图、差异图和候选 manifest；审阅后 `pnpm test:visual:accept -- --candidate <id>` 才更新登记基线。正式 PNG 不进入视觉源码摘要；明确登记基线增删，CI 只比较不生成或接受候选。
- GitHub Actions 在 push/pull_request 上执行冻结安装、RouteKey 与测试架构结构检查、lint、typecheck、build、unit、PC browser、固定容器视觉比较和隔离 migration checks；不跑 BrowserSkill，CI 绿色不等于八场景验收通过。无生产部署配置。

### 仓库目录

```text
frontend/src/
  app/                 # Vue 根组件
  layouts/             # 后台壳、导航、标签和通知
  router/              # 静态路由、动态 RouteKey 与守卫
  stores/              # session / permission / ui / tabs / notification
  features/            # 按业务域组织页面、组件和服务
  components/          # 跨业务组件与 shadcn-vue / Reka UI 源码
  config/              # 应用与布局配置
  style/               # Tailwind tokens、全局 CSS 与布局 SCSS
  lib/supabase/        # Supabase JS client
  utils/               # 纯前端通用工具
supabase/
  migrations/          # 当前选定轨道的 migration
  baselines/           # 固定 cutoff 基线与共同增量输入
  functions/           # Deno Edge Functions
    _shared/contracts/ # 前后端共用的 @template/contracts Zod 包
  tests/               # pgTAP 数据库权限与行为测试
  seed.sql             # 本地/测试基础数据
scripts/               # 本地开发、首次管理员和验收入口
```

页面不直接发起 Supabase 请求；数据访问经所属业务域的 feature service。

### 验证层

- `pnpm typecheck`：前端 Vue/TypeScript、共享合同和三个 Deno Edge Functions。
- `pnpm format:check` / `pnpm format`：按 `.prettierrc.json` 检查或写入 `frontend/src/**/*.{vue,ts}`；`.prettierignore` 排除 CLI 生成的 `frontend/src/components/ui/`，Markdown 与设计文档不参与格式化。
- `pnpm test:unit`：Vitest、Vue 组件、共享合同与脚本测试，按业务覆盖响应解析、错误、会话归属和字符串 ID 等断言；具体覆盖以测试为准，不保证每个 Service 都有全部类别。Mock 单测不能证明服务端权限，真实权限由 RLS/Edge 集成验证。
- `pnpm check:test-architecture`：CI 结构门禁（白名单、退休登记、逐断言映射结构）。`pnpm check:test-architecture:acceptance`：另要求当前源码匹配的 suite/BrowserSkill 账本。
- `pnpm test:browser`：PC Chromium Session 竞态、权限导航与所有注册路由 × 三布局 × 双主题布局矩阵；成功不保存逐页截图。
- `pnpm test:browser:local`：Mailpit 恢复、PC 浏览器登录、字典类型真实 CRUD、消息 Realtime 收件、刷新恢复、越权路由拒绝、登出及旧 access token 的 RLS 拒绝。
- `pnpm test:visual`：固定 Linux amd64 Playwright 容器比较 14 状态：登录双主题、Dashboard 三布局双主题、用户表格双主题、Profile 表单双主题、角色授权弹窗双主题。
- `pnpm test:visual:update`：仅生成固定副本中的候选 PNG、原图、差异图和 manifest；审阅后 `pnpm test:visual:accept -- --candidate <id>` 才更新正式基线。
- `pnpm test:agent:start/record/verify/retire/cleanup`：固定输入与规则摘要、八个 BrowserSkill 场景 checkpoint 报告、证据完整性与批次删除门槛。
- `pnpm test:db`：本地 Supabase pgTAP、RLS、Edge、Storage、Realtime 和审计集成检查。
- `pnpm check:migrations`：在独立临时 Supabase project/动态端口从空库重放 migrations 和 seed，检查重复 seed、DB lint/advisors、Auth bootstrap 并发、pgTAP、服务集成与本地 Auth 浏览器流，并回收该临时栈。
- GitHub Actions `quality` 在 push/pull_request 上依次执行冻结安装、`check:routes`、`check:test-architecture`（仅 `--mode ci`）、`check:docs`、lint、安装 Chromium、typecheck、build、unit、browser、`check:migrations`、`check:migration-upgrades`。独立 `visual` job 比较固定容器中的像素基线，不生成或接受候选。不执行 `check:test-architecture:acceptance`。

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

### UI 组件与兼容实现

组件从官方 shadcn-vue registry 通过 CLI 加入仓库，源码位于 `components/ui/`；业务页面组合 Dialog、AlertDialog、Table、NativeSelect、Textarea、Checkbox、Switch、Field/FieldGroup/FieldLabel 和 Alert，布局组合 DropdownMenu、ContextMenu、Popover、Collapsible、Skeleton，通知使用 Sonner。复杂交互的键盘、焦点锁定、遮罩和定位由库处理；业务层只负责数据、权限、打开状态及必要的实际触发按钮焦点归属。DialogTitle 的 ID 由库生成并关联，不能以页面自定义 ID 覆盖。路由页面保留单一 DOM 根节点，Dialog 放在该根节点内，保证布局属性和 Transition 生效。

简单选择使用 shadcn-vue 官方 NativeSelect，保留空选项、原生 required 校验、数值分页和 BIGINT 字符串；读取新值的业务回调订阅 `update:modelValue`，避免组件内部模型尚未同步时读取旧筛选值。只为全宽表单补充 `wrapperClass` 布局入口。共享确认桥接使用 VueUse `useConfirmDialog`，UI 使用 AlertDialog，切换路由、Session 或卸载时取消待确认动作；确认按钮在默认关闭之前完成授权。

`mitt` 的唯一事件发送没有订阅者，连同通道删除；无调用的 faker、postcss-html、postcss-scss 和直接 svgo 声明已移除。SCSS、responsive-storage、路由进度、图标和动画依赖仍有实际调用，保留其现有功能。`ReIcon` 仍用于菜单图标；不存在的 `ReAuth` / `RePerms` 全局类型已删除。手写 Toast 计时器和 DOM 事件实现已由 Sonner 替换。

### 验证状态

架构描述不等于整套验收通过。2026-10-09 只读查询 GitHub Actions，最近运行 [37875704153](https://github.com/kanelogger/fullstack-admin-template/actions/runs/37875704153)（commit `1f819a09cf8f05487fc6ea3d9a9e59801fad5edc`）状态为 failure，前两次查询结果也为 failure。这些结果对应远程提交，不能代表当前未提交工作区。普通 PR CI 与 BrowserSkill 验收门禁已拆分，见 [ADR 0011](../docs/adr/0011-split-ci-and-browserskill-acceptance-gates.md)；UI 或依赖变化后，旧 BrowserSkill 报告须重新核对输入摘要才能用于 acceptance / retire，不能直接沿用。

2026-10-09 在当时未提交工作区（产品摘要 `20dd719e09790c30f94a264905dd4e00369fabc46c18275e142e74c194068148`、场景执行摘要 `4698c8d1c32ea3219a111f941fd9f7f23ba0a12d2ecb00543717c7b26fb9f07e`）重跑八个 BrowserSkill 场景，34/34 checkpoint 为 `Pass`，统一 `pnpm test:agent:verify` 返回 `valid: true`，并刷新验证账本与具名 run ID 引用；`pnpm test:unit`（前端 78、组件 21、Edge HTTP 3、共享合同 21、Node 78）、`pnpm test:browser`（14 通过、2 跳过）与固定 Linux `pnpm test:visual`（14 通过）同时通过。附件上传按钮把组件 ref 当原生 DOM 的回归与修复见 [ADR 0009](../docs/adr/0009-attachment-upload-fix-and-acceptance-refresh.md)；格式检查范围扩展到整个前端源码、路由元数据解析解耦与随之而来的再次验收见 [ADR 0010](../docs/adr/0010-format-scope-and-route-metadata-parsing.md)。上述结论只对应该工作区状态；其后源码继续变化时，历史账本仅作 `acceptance-only` 归档，普通 CI 结构门禁不再要求其摘要匹配。
