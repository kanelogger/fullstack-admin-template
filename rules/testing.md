# 测试约定

项目以 PC Chromium 为目标。合同、Service、Store、组件、Supabase 集成、Playwright 和 BrowserSkill 提供不同证据；不能用其中一层的通过代替其他层。

## 分层与入口

- `pnpm test:unit`：Vitest、共享 Zod 合同和本地脚本测试。输入解析、BIGINT 字符串 ID、部门 parent ID 与完整层级路径、父级选择防循环、权限、CRUD 状态、错误处理、重试和异步状态归属放在相应 Service/Store/组件测试中。
- `pnpm test:components`：只运行 `*.component.test.ts` 的 jsdom Vue 组件测试；根 `test:unit` 已包含该层。
- `pnpm test:db`、`pnpm check:migrations`、`pnpm check:migration-upgrades`：验证当前本地或独立临时 Supabase 中的 Auth、Edge、RPC、RLS、Storage、Realtime、部门层级外键/循环/软删除、pgTAP 与 migration 兼容性；不可重置远程或用户已有业务库。
- `pnpm test:browser`：Playwright Chromium 白名单，只运行 Session 竞态、权限导航、Local Auth、首位管理员登录和全路由布局矩阵。报告位于 `frontend/test-results/browser/` 与 `frontend/playwright-report/browser/`。
- `pnpm test:browser:local`：真实本地 Supabase/Mailpit 浏览器链路，覆盖恢复、登录、字典 CRUD、Realtime、刷新、越权拒绝、退出与旧 token 的 RLS 拒绝。报告位于 `frontend/test-results/browser-local/` 与 `frontend/playwright-report/browser-local/`。
- `pnpm test:visual`：固定 Linux amd64 Playwright 1.63.0 Noble 容器中的 14 个像素状态比较。状态为登录双主题、Dashboard 三布局双主题、用户表格双主题、Profile 表单双主题和角色授权弹窗双主题。未知请求必须失败；测试固定时间、字体来源、视口及 Zod 校验 fixture。
- `pnpm check:test-architecture`：CI 结构门禁。检查 Playwright 白名单、旧测试登记、逐断言覆盖映射结构与替代引用是否存在；不要求已提交的 BrowserSkill/suite 摘要匹配当前源码，也不宣称 BrowserSkill 通过。
- `pnpm check:test-architecture:acceptance`：发布/Agent 验收门禁。在结构检查之外，要求账本中的 unit/browser suite 通过记录与八场景 BrowserSkill 报告的产品/场景摘要均匹配当前工作区。

Playwright 只允许以下 spec：`session-race.spec.ts`、`navigation-authorization.spec.ts`、`auth-recovery-local.spec.ts`、`default-admin-login-local.spec.ts`、`visual-route-review.spec.ts`、`dashboard-visual.spec.ts`。正式基线 PNG 不参与源码摘要。

布局矩阵从 `registeredMenuRoutes` 读取 RouteKey、路径和权限，覆盖所有注册路由 × 垂直/横向/混合三布局 × 浅色/深色主题；检查页面标题、主题、布局、横向溢出、活动菜单可见性，以及横向和混合导航滚动。成功不逐页截图，失败保留截图、trace 和 report。

## BrowserSkill 报告与删除门槛

BrowserSkill 用途摘要包含产品源码与静态资源、共享合同、migrations/seed/迁移轨道输入、依赖清单和锁文件、运行配置、场景 fixture、Playwright helper 与验收 runner。视觉摘要包含渲染输入、依赖与构建配置、像素测试和视觉 fixture。两者使用统一 SHA-256 规则，输出用途、规则版本和校验值、排序路径清单、逐文件摘要及汇总摘要。输入规则与排除规则文件自身计入摘要；未忽略的未跟踪文件也计入。报告、缓存、运行态、凭据、正式像素基线以及显式登记待退出的 E2E 和专属设施按用途排除。

每次验收先计算工作区摘要，创建固定副本，按冻结锁安装依赖并确认副本摘要相同，从副本启动应用与隔离 Supabase。副本输入设为只读。结束时固定副本必须与启动时完全一致，产品与场景执行摘要也必须在启动、固定副本、结束工作区间一致；管理/断言账本变化单独报告，不使产品结果变成 `Unknown`。删除旧测试前再次核对 suite 摘要、当前逐断言清单、报告和工作区。恢复到相同文件路径和内容会恢复对应摘要有效性。

报告摘要分成产品输入、场景执行输入、验收管理输入和逐断言清单。产品源码与场景执行摘要都必须匹配当前工作区，才能复用 BrowserSkill 报告；场景执行摘要涵盖 runner、账号/fixture 准备、启动配置与规则。只有明确列入管理 allowlist 的验证/记录工具及 Playwright 测试层差异才单独报告 drift；逐断言清单也单独报告。上述管理或清单变化不得改写历史报告，旧测试删除仍须由当前逐断言清单、具名替代测试/场景和完整 suite 摘要下的通过结果独立授权。

`pnpm test:unit` 和 `pnpm test:browser` 的 suite 摘要从完整 Git 文件清单（tracked 与未忽略的 untracked）筛选各自实际输入，不得从 BrowserSkill 已筛选过的文件清单计算。Unit 摘要包括 Vitest 配置、所有 Node 测试及其 `scripts/` 支持输入、前端/Edge 测试源码与对应运行配置；Browser 摘要包括 Playwright 配置、active spec、helpers 与运行器。断言账本不纳入自身 suite hash，避免形成自引用。普通 CI 以现场执行 `pnpm test:unit` / `pnpm test:browser` 为准，不依赖已提交 suite 摘要；suite 摘要只服务 acceptance / retire 门槛。

八个稳定 BrowserSkill 场景为 `dashboard`、`messages-shell`、`organization`、`configuration`、`identity-navigation`、`attachments`、`audit`、`profile`。每个场景的 checkpoint ID、期望结果和必需证据定义在 `scripts/test-architecture-rules.json`。每个 checkpoint 按 `Pass`、`Fail`、`Unknown` 或 `Skipped` 记录观察结果和证据路径。截图/debug 不是产品通过的推断来源，只核对证据完整性和引用有效性。

Codex CLI 模式在每个场景启动时显式传入 `--browser <instance-id>`；runner 通过 `bsk session start --browser <instance-id> --json` 创建该实例的 session，并在 cleanup 时停止。业务操作必须经过页面；管理员 client 只准备 run 专属 fixture、核验 Session/RLS 结果和清理。CLI cleanup 导出 `final.png` 与 `browser-debug.json`。DeepSeek Harness 环境可传 `--browser-session <session-id>`，并从 Harness 导入同名证据；不得跨环境替换 BrowserSkill driver。

临时 Supabase project ID 必须在生成时规范到不超过 40 个字符；清理 helper 对超过上限的 ID fail closed，不能按原 ID 查一个会被 CLI 截短的 Compose 标签。

debug 证据须包含唯一的捕获 run；其 `session_id` 必须等于报告的 BrowserSkill Session ID，捕获 URL 的 origin 必须等于报告 `appOrigin`，开始、停止和保存时间须落在报告运行时间窗内。仅存在 `run` 或 `runs` 字段不构成有效证据。

保留 `pnpm test:agent:start/fill/cleanup`，并使用：

- `pnpm test:agent:record -- --run-id <id> --checkpoint <id> --status Pass|Fail|Unknown|Skipped --observed <text> --evidence <paths>`：记录一个 checkpoint。
- `pnpm test:agent:verify -- --run-ids <id,...> [--scenario <id>]`：单场景检查该场景必需 checkpoint；全量检查需显式提供报告集合，并且当前八组场景各有一份有效报告。
- `pnpm test:agent:retire -- --batch <batch> --run-ids <id,...>`：复用 verify 门槛，核对每个旧测试的断言数、原文件 SHA-256、逐断言替代测试与 BrowserSkill checkpoint，再一次性删除登记目标；任何验证失败都不删除。

verify 仅当所有必需 checkpoint 均为 `Pass`，观察结果和证据引用有效，截图/debug 文件完整且与 Session、origin、时间窗绑定，产品摘要与场景执行摘要都匹配，规则匹配，固定副本从启动到结束保持不变，资源清理成功时返回 0。缺项、冲突、`Unknown`、`Skipped`、清理失败、引用无效、产品摘要/场景输入变化或规则变化均返回非零。管理输入和逐断言清单 drift 单独报告；清理退出码只表示资源回收，产品状态、证据状态和清理状态独立保存。旧报告保留可读性，不回写旧报告摘要。

旧测试按批次迁移：消息与壳 → 组织与配置 → 用户、角色与菜单 → 附件与审计 → 登录、Profile 与收尾。每批顺序为替代测试通过、相关 BrowserSkill 场景通过、verify 通过、retire 删除。当前未通过该顺序的 Smoke 必须保留。重叠行为可以共享替代测试，但 assertion manifest 必须为 AST 找到的每个 `expect` 调用单独记录源位置、源码指纹和替代映射/保留理由；禁止把用例级 coverage 扩展复制到全部断言。

## 视觉基线候选

`pnpm test:visual:update` 在固定副本生成 14 个状态的候选 PNG、原图、差异图和独立 manifest；不修改正式 PNG。必须在实际审阅候选和差异后显式调用 `pnpm test:visual:accept -- --candidate <id>`。accept 校验当前视觉摘要和规则、候选完整性、正式基线原摘要及新增/删除登记，再原子更新 manifest 内目标；失败回滚全部文件。CI 只运行 `pnpm test:visual`，不生成或接受候选。Playwright browser、browser-local 与 visual 报告分开保存。

## 安全、清理与证据

- 不连接远程 Supabase；日志和报告不输出 service-role/secret key；浏览器只使用 publishable key。
- `pnpm test:db` 只写当前 Local 栈的合成 fixture 并清理。运行前核对 project/端口归属。
- 隔离迁移检查只停止并删除自身创建的容器和数据卷；不得停止无关容器或执行当前项目数据库 reset。
- BrowserSkill、migration 和 upgrade 验收栈使用唯一 project ID、临时端口和系统临时目录；Supabase CLI stop 成功后还须核对该精确 Docker project label 下容器、卷、网络均已消失。停止失败、资源查询失败或仍有资源时保留恢复目录和诊断信息。
- fixture 必须按 run ID 清理；test data 不写入 seed。Playwright 诊断不得互相覆盖。

## 报告结果

明确记录命令、退出码和覆盖范围。指出跳过、未覆盖、不可用或结论不明确的检查。不得把静态检查、构建或 Mock 浏览器结果描述成真实 Auth/RLS/Realtime 验收。
