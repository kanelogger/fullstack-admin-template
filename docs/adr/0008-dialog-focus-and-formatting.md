# 0008：统一焦点归属、业务文件格式与视觉容器身份

- 日期：2026-10-09
- 状态：已实施；格式化范围已由 0010 扩展到整个前端源码，验收证据以 0010 为准

## 评价与选择

模板格式问题、9 页焦点代码重复、用户列表加载/空态留白丢失，以及设计文档顶部先显示过期状态的评价均成立。现有本地检查通过只证明相应测试范围，不能替代八个真实 BrowserSkill 场景。

使用固定 Prettier 3.8.3 格式化业务 Vue 页面、composables 与 message 适配层，提供 `pnpm format` / `pnpm format:check` 并在 CI 检查。格式化入口不匹配 Markdown，避免改写只能增补的设计文档。

将焦点归属提取到 `useDialogReturnFocus`，每个实例保存自己的触发按钮；同步打开的弹窗通过 open ref 捕获，附件和审计仍在请求前显式 capture。关闭后清空引用，目标已移除时保留 Dialog 的默认恢复行为。该 composable 只处理业务触发按钮归属，焦点锁定、键盘与弹窗生命周期仍由 shadcn-vue / Reka UI 实现。

恢复用户列表加载与空态的垂直留白和 muted token，使用内部 status 元素保留 table cell 语义。增加实际加载到空态的组件回归，以及异步捕获、两个独立弹窗和原行移除后的焦点测试；原有 Dialog 双触发按钮测试改为使用共享 composable。

设计文档的原状态行与所有原设计文字保留，在旧状态下面新增带日期的实施说明链接。逐行 diff 核对只存在 insert，未删除或改写原文。

## 远程 CI 与容器修复

读取旧提交的两个远程失败日志后确认：quality 被验收摘要/报告门槛拦截；visual 14 项通过后，宿主删除 root 容器生成目录时权限失败。容器改为宿主 UID/GID，Corepack 在容器 `/tmp` 安装 shim，避免全局路径写权限和 root 属主文件。修改后固定 Linux 比较和宿主清理均成功。旧远程失败保持原记录，不把本地通过写成远程通过。

## 本次检查

- format、lint、完整 typecheck、build、docs、routes 和 diff 检查通过。
- 完整 unit 通过：前端 78、组件 18、Edge HTTP 3、共享合同 21、Node 脚本 74。
- Chromium 14 项通过，2 项真实 Local Auth 用例按配置跳过。
- 固定 Linux visual 14 项通过，未更新正式像素基线。
- 产品与场景执行输入在开始真实验收后保持不变。

## 真实验收阻塞

通过当前 BrowserSkill 实例 `fb5e899d` 启动了 Dashboard 隔离 run `5fb5a150-0c04-4826-88bc-1290bc6c70f7`，Session `bxym`，独立应用和 Supabase 达到 READY。debug 从导航前开始并绑定本次 origin。登录页可观察，但填充时 Chrome 拒绝 CDP 访问另一个扩展的 `chrome-extension://` 框架；按提示重新导航后仍失败。页面曾出现 CocoCut 注入痕迹，不能据此确认它就是冲突来源。

本次未完成登录或任一产品 checkpoint，产品状态保持 Unknown，不回写旧报告或把 Mock 结果替代真实场景。需要浏览器侧排查注入框架的冲突扩展后重新启动场景；未得到人工处理确认前不再反复尝试、不更换后端绕过限制。后续仍需八场景、当前 unit/browser suite 摘要与验收账本全部匹配后让 `check:test-architecture` 通过。
