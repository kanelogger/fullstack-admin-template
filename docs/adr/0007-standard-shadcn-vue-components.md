# 0007：优先使用官方 shadcn-vue 组件

- 日期：2026-10-09
- 状态：生效；八场景 BrowserSkill 证据已按 0009 于 2026-10-09 刷新
- 取代：0006 中自制 AppDialog 与保留手写控件的临时选择

## 决策

按用户明确要求，UI 从官方 shadcn-vue registry 使用 CLI 2.8.2 添加组件，按现有 `components.json` 的 Vue / new-york / Tailwind v4 配置接入，不使用 React CLI。已有 Button、Label 源码保留，CLI 覆盖提示选择 no。

9 个业务页面的 13 个弹窗及菜单搜索弹窗直接组合标准 Dialog、DialogContent、DialogTitle、DialogDescription、DialogClose 和 DialogTrigger；删除自制 AppDialog。弹窗迁移由用户指定的 gpt-6-luna 子代理执行，主代理复查并修正实际触发按钮焦点、可访问名称关联和路由页面根节点。DialogTitle 使用库生成 ID；Dialog 不占据路由页面的 DOM 根节点。多个行按钮和异步预览在业务层记录实际触发按钮，关闭时恢复该按钮。

业务表格使用 Table；普通表单使用 Field/FieldGroup/FieldLabel、Input、NativeSelect、Textarea、Checkbox、Switch；错误反馈使用 Alert。简单选择保留原生选项、空值、required、数值分页与 BIGINT 字符串，选择变化回调在模型同步后执行。NativeSelect 仅增加 wrapperClass 布局入口。

应用壳使用 DropdownMenu、ContextMenu、Popover、Collapsible、Skeleton；Toast 使用官方 Sonner，删除自制事件通道与计时器。业务 `message()` API 保留为薄适配层，关闭动作委托给 Sonner。

10 处浏览器确认改为官方 AlertDialog，通过已有 VueUse `useConfirmDialog` 连接异步业务动作。路由变化、Session 切换和卸载会取消等待中的动作；新请求取消上一请求。确认点击在组件默认关闭之前完成授权，避免默认 close 被误判为取消。取消与 Escape 均不发送写请求。

## 依赖清理

删除无调用的 faker、postcss-html、postcss-scss 和直接 svgo 声明。mitt 只有唯一 emit、没有订阅者，删除其依赖、通道、发送调用及预构建项。svgo 仍可作为 SVG loader 的间接依赖存在，这不表示项目仍直接依赖它。

仍有调用的 SCSS/Sass、responsive-storage、动画、路由进度、图标、收藏排序、拼音匹配和构建工具继续保留。新增加的直接依赖是用于替换手写 Toast 的 vue-sonner。

## 回归关注点

- Dialog 键盘、焦点锁定、Tab 环绕、Escape、DialogClose、多个触发按钮的焦点恢复。
- AlertDialog 的取消、Escape、实际确认点击、Session 改变和重叠请求的取消。
- NativeSelect 的 BIGINT 字符串不转 Number；数值分页仍为 number；加载回调读取新筛选值。
- Vue 路由页面保留单根，布局 class 和 Transition 继续生效。
- PC Chromium 全路由 × 三布局 × 双主题，标准菜单与退出竞态。
- 固定 Linux 14 状态视觉候选需实际审阅原图和差异后再接受，不直接重录正式基线。

本次不改数据库、migration、远程服务或旧 BrowserSkill 报告。输入摘要变化后，八场景和验收账本仍需重新验证，不能把本地 Mock 浏览器结果当成真实 Auth/RLS/Storage/Realtime 证据。

## 本次验证记录

`pnpm test:unit` 退出 0：前端 75、组件 17、Edge HTTP 3、共享合同 21、Node 脚本 74 项通过。`pnpm lint`、完整 `pnpm typecheck`、build、docs、routes 和 `git diff --check` 均通过。Dialog 宽度断点修正后再次运行组件、lint 和完整 typecheck，仍通过。

`pnpm test:browser` 退出 0：14 项通过，2 项真实 Local Auth 测试按配置跳过。浏览器回归验证了用户表单的官方 Checkbox 和 NativeSelect、确认框取消与 Escape 不写请求、实际确认恰好执行一次删除、退出与 Session 竞态，以及全部注册路由的三布局双主题矩阵；接口使用 Mock，不能证明实际数据库权限。

视觉候选 `be64a681-f66c-4406-a21a-551b19dc19a4` 的 14 状态原图、候选与差异已逐项审阅。变化为官方 Field 间距、Table 密度、菜单触发器和 Dialog 样式；修正官方默认 `sm:max-w-lg` 对大弹窗宽度的覆盖。候选内部重录后复比 14 项通过，显式 accept 退出 0，更新 14 个正式 PNG。此前候选 `c41ccf34-3413-48c8-8d03-4ef9e22ff612` 未接受。接受后 `pnpm test:visual` 再次在固定容器运行，退出 0，正式基线 14 项全部通过（315 个输入摘要）。

`pnpm check:test-architecture` 退出 1：历史产品/场景/suite 摘要过期，八个 BrowserSkill 场景没有匹配当前源码的通过报告。已执行的 unit/browser 通过不自动改写账本，下一步必须按既有协议刷新真实场景和账本。没有提交、推送、数据库修改或远程部署。
