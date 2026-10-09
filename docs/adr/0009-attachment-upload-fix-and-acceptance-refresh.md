# 0009. 附件上传按钮回归修复与八场景真实验收刷新

- 日期：2026-10-09
- 状态：生效；其 2026-10-09 验收快照已由 0010 的全量格式化后再次验收取代（修复决策本身不变）
- 背景：
  - shadcn-vue 迁移把附件页的文件输入改为官方 `Input` 组件后，业务代码仍按原生元素使用模板 ref（`selectedFile.value?.click()`）。运行时 ref 是组件实例，点击可见按钮抛 `TypeError: selectedFile.value?.click is not a function`，两次真实操作都没有上传任何文件；产品源码因此变化，旧八场景报告的产品摘要全部失效。
  - 交付真实文件时 Chrome 拒绝 `DOM.setFileInputFiles`（`-32000 Not allowed`），bsk 提示需要扩展的“允许访问文件网址”权限。这属于浏览器能力前提，不是产品缺陷；没有更换浏览器后端或自动化设置。
- 决策：
  - 保留官方 `Input`，用 VueUse `unrefElement` 取得组件实例的真实 DOM，再用 `instanceof HTMLInputElement` 收窄后调用 `click()`；不把 ref 类型标注成 `HTMLInputElement` 掩盖运行时差异，也不为绕过回归换回自制上传控件。
  - 增加组件回归 `frontend/src/features/attachments/pages/attachments/index.component.test.ts`：点击可见按钮必须触发原生 file input 的 click；`change` 事件走真实上传 handler，覆盖业务模块转发与 trim、上传后清空 input、无文件时忽略。
  - 真实验收按最终冻结源码重跑八个场景，并用仓库现有 `pnpm test:agent:verify` 协议核对完整集合后刷新 `scripts/test-architecture-assertions.json` 的验证账本与具名覆盖引用；历史报告、断言指纹、来源与旧摘要不改写。
- 备选方案与否决原因：
  - 只改 ref 泛型为 `HTMLInputElement`：类型通过但运行时仍是组件实例，缺陷仍在。
  - 用原生 `<input class="sr-only">` 替换官方 `Input`：退回迁移前状态，违背复用官方组件的目标。
  - 用 `bsk upload --mode drop` 或页面内合成 `change` 事件投递文件：前者在 `effect_state=unknown` 时被 BrowserSkill skill 明确禁止，后者不是真实用户文件选择，不能作为上传证据。
  - 手改旧报告摘要、放宽门槛或把旧报告当作新源码证据：违反摘要归属与证据完整性约束。
- 证据：
  - 回归先失败后通过：修复前该测试报 `selectedFile.value?.click is not a function`，修复后 3 项通过；`pnpm test:components` 21 项通过，`pnpm format:check`、`pnpm lint`、`pnpm typecheck` 退出 0。
  - 真实上传（run `4456eb0d-6d39-44fb-9df0-9f469d6592ab`）：点击可见按钮“选择文件并上传”后浏览器弹出并被拦截到原生文件选择器，交付 24×24 PNG（99 B）；列表出现 `image/png`、`99 B`、未引用与上传时间行，状态行显示“已上传 architecture-acceptance-upload.png”；下载字节 SHA-256 `0bfa4313f5d929165f941405d20cd29d3137ac100e259f76f4f6f6893eefafff` 与上传文件一致；AlertDialog 确认删除后列表回到“暂无附件 / 共 0 条”。未授权 COMMON_USER fixture Session 的元数据写入被 RLS 以 `42501` 拒绝、Storage 写入 `403`、元数据读取 0 行。
  - 八场景在当前产品摘要 `4f59a7335cf6283070b9c7ae960e78e98c7ced791ed0ec068f199be2563459c4`、场景摘要 `4698c8d1c32ea3219a111f941fd9f7f23ba0a12d2ecb00543717c7b26fb9f07e` 下重跑，`pnpm test:agent:verify` 全集合返回 `valid: true`：

| 场景 | BrowserSkill run ID | checkpoint |
| --- | --- | ---: |
| `dashboard` | `0d7ae77a-6011-46da-b9b6-d05239be1d00` | 4/4 |
| `messages-shell` | `21038b62-ce89-4d58-973a-66e91d35eef5` | 4/4 |
| `organization` | `1b323e90-a316-46d5-b239-95e36bdf6a1a` | 4/4 |
| `configuration` | `3261c90a-e3fa-450f-aa6f-c97643f2e550` | 4/4 |
| `identity-navigation` | `0722143c-733c-4c06-87b8-c36055516799` | 7/7 |
| `attachments` | `4456eb0d-6d39-44fb-9df0-9f469d6592ab` | 4/4 |
| `audit` | `93bacfce-853f-44f0-af17-20affd9ae541` | 4/4 |
| `profile` | `764d8252-fc32-4f42-b33f-12bfdd0b3490` | 3/3 |

  - 本地回归：`pnpm test:unit` 前端 78、组件 21、Edge HTTP 3、共享合同 21、Node 脚本 74 项通过；`pnpm test:browser` 14 项通过、2 项真实 Local Auth 用例按配置跳过；固定 Linux `pnpm test:visual` 14 项通过（319 个输入摘要，正式基线未改动）；`pnpm check:docs`、`pnpm check:routes`、`git diff --check` 通过。
  - 资源清理：八个 run 均 `cleanupStatus=Succeeded`、`retainedProjectRoot`/`retainedWorkspaceRoot` 为 null；核验无 `agent-*` 容器、卷或网络残留，BrowserSkill session 列表为空。
  - 附件页隐藏输入框的 `sr-only` 由 Tailwind v4 `clip-path: inset(50%)` 生效：布局盒仍为 898×40，但不可见且不参与命中测试，可见按钮是实际点击目标；本轮未改动该标记。
  - 场景内的故障注入与 fixture 均在报告观察中显式区分：通知重试只临时阻断未读计数 HEAD 读请求并解除后恢复；组织/身份场景的 RLS 与旧 token 拒绝来自独立注册的 fixture Session；审计异常日志因模板没有运行时异常写入器，使用 run 专属已脱敏 fixture 行并说明页面为真实服务读取。
  - 本轮没有提交、推送、远程部署或数据库改动；远程 CI 状态仍未由新提交证明。
