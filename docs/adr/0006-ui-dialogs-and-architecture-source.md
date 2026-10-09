# 0006：统一业务弹窗与架构事实来源

- 日期：2026-10-09
- 决策状态：设计文档精简方案已撤回，原设计仅允许增补；自制 AppDialog 与控件保留策略已由 [0007](0007-standard-shadcn-vue-components.md) 取代

## 评价核实

外部评价指出的手写弹窗焦点管理缺口、架构目录/CI 清单偏差与两份文档重复维护问题成立。现有 Button 已使用 Reka UI，因此“没有真正用上 shadcn-vue”应收窄为复杂交互组件使用不足。

`responsive-storage`、`mitt`、`animate.css`、`@vueuse/motion`、`nprogress`、`boxen`、`gradient-string`、`vite-plugin-router-warn` 和 Sass 在源码或构建配置中仍有调用。当前源码未找到评价所说的 `PureIcon`，存在并被调用的是 `ReIcon`。`ReAuth` / `RePerms` 只留下引用不存在模块的全局类型声明，已删除这两个过期声明。技术栈允许布局保留 SCSS，不能因依赖名称或组件命名就判定无用。`@faker-js/faker` 没有调用，已删除并同步锁文件。空 `src/api` 与 `src/plugins` 未跟踪，已清除本地空目录。

测试文件数量不能判断覆盖。抽查 attachments、audit、messages、profile、users 后，无法支持“每个 Service 都完整覆盖响应、错误、权限、字符串 ID”的表述，事实文档已改为按业务与测试证据说明。Mock 单测不能证明 RLS 权限。组织与审计的共享页面承担多种页面复用，文件名差异本身不影响边界，不做批量路径重命名。

“完整历史轨有 5 条 legacy 导入 migration”数量不准确：搜索函数定义有 7 条，部分文件名没有 legacy；后续 cleanup 撤销入口，固定 baseline 不携带这些历史文件。“GitHub Actions 等待首次远程运行”已过时，查询到最近三次远程运行均失败，具名链接记录在架构事实文档。

## 选择

在 `components/ui/dialog/AppDialog.vue` 集中组合 Reka DialogRoot、Portal、Overlay、Content 和 Title，统一焦点锁定、Esc、遮罩关闭与关闭后焦点恢复。9 个业务页面的 13 个弹窗接入共享组件，保留业务状态、保存处理与表单内容。页面在打开前捕获焦点，解决没有 DialogTrigger 的既有操作按钮关闭后恢复焦点的问题。

原生 table 和 select 已提供对应语义，单纯包装不能减少业务逻辑；暂不批量引入 table、select、dropdown-menu、form 或替换浏览器确认框。需要复杂交互时再采用对应 Vue 组件。此次主要解决明确的弹窗行为缺口，页面业务逻辑规模仍需按领域实际复用关系决定是否拆分。

`specs/architecture.md` 记录当前实现事实，补齐目录、双轨迁移、CI 步骤与测试证据范围。根据用户明确约束，`docs/diagram/architecture.md` 是完整设计文档，已恢复所有原有内容，今后只允许增补；原先精简该文档的方案撤回。实施说明独立放在 [`architecture-implementation.md`](../diagram/architecture-implementation.md)。README 增加日常验证入口，完整 Supabase 验收继续独立执行。

## 验证与限制

共享组件增加键盘、背景焦点逃逸、Tab 环绕、Esc 关闭与恢复焦点的回归测试；组织页面测试保留真实组件行为，仅将 Portal 渲染留在测试 DOM 中。

本次没有修改 migration、数据库数据、正式像素基线或历史 BrowserSkill 报告。产品和依赖发生变化，旧八场景报告的输入摘要不匹配；`check:test-architecture` 当前失败，不能宣布全套门禁完成。真实 BrowserSkill 八场景需要重新运行。

本次实际验证：`check:docs`、`check:routes`、lint、完整 typecheck、build 和 `test:unit` 均退出 0。unit 分层结果为前端 73、Vue 组件 11、Edge HTTP 3、共享合同 21、Node 脚本 74 项通过。`test:browser` 退出 0：14 项通过，2 项 Local Auth 测试按配置跳过；它没有验证真实数据库链路。`test:visual` 退出 0：固定 Linux 容器 14 状态全部通过，未更新基线。删除过期类型声明后再次运行前端 typecheck 与文档检查，均退出 0；`git diff --check` 通过。`check:test-architecture` 退出 1，因旧 product/scenario/suite 摘要和八场景报告未刷新；执行通过的 suite 结果不能自动替代账本验证。
