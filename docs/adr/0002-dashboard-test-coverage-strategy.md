# 0002. Dashboard 测试覆盖分层与 Smoke 迁移

- 日期：2026-10-07
- 状态：Dashboard 局部迁移决策；全项目测试退出和验收门槛由 [ADR 0003](0003-full-test-architecture-migration.md) 扩展
- 背景：Dashboard 原有 Playwright Smoke 同时承担服务调用、页面显示与错误重试验证。逐步替换时，需要保留真实浏览器行为证据，并避免用测试文件行数变化代表维护成本变化。
- 决策：
  - Service 测试验证 `dashboard_overview()` 调用、响应合同和错误传播；jsdom 组件测试验证数据展示、字符串 ID 路由、首载失败重试、刷新失败保留旧数据、`messageRevision` 重载及卸载隔离。
  - 四个 Dashboard 视觉基线使用合同校验后的固定 Mock，在固定 Linux Playwright 容器中生成和比较；基线更新需审阅候选图与差异图。导航滚动、活动项可见及横向溢出巡检继续保留。
  - Playwright Mock E2E 继续覆盖多页面交互和 Session 竞态；BrowserSkill 真实验收使用显式指定的浏览器实例、唯一临时 Supabase 项目和 run 专属消息/操作数据。就绪探针以登记 Session 调用者验证 Dashboard RPC、动态菜单和消息读模型。
  - 只有每条旧断言都有替代测试映射、视觉自动化通过且指定 BrowserSkill 真实验收为 `Pass` 时，才删除对应 Smoke。证据缺失、`Unknown` 或清理失败都阻止删除；产品状态和资源清理状态独立记录，截图与调试记录在停止 Session 前导出。
  - 试点通过后只删除 Dashboard Smoke，其他 Smoke 保留。维护成本持续观察组件测试、fixture、场景说明的维护量、CI 时长和误报；40%–60% 行数缩减只作为观察目标。WebMCP-ready 继续复用当前 Service 与合同边界，暂不新增动作框架。
- 备选方案与否决原因：一次性删除所有 Smoke 会失去未承接的真实交互覆盖；只增加组件测试会遗漏浏览器布局、消息导航和真实 Auth/RLS 链路；把所有验证留在 BrowserSkill 会降低确定性并增加人工诊断成本；只按 Playwright 行数判断维护收益不反映 fixture、组件测试和 CI 的新增负担。
- 证据：2026-10-07 Dashboard BrowserSkill run `325b75a0-7bc5-4f52-a3e6-f98304703a09` 在指定实例 `fb5e899d` 上通过，完成待办导航、消息已读更新、返回 Dashboard 与刷新；报告 `productStatus=Pass`、`cleanupStatus=Succeeded`，包含 `dashboard-final.png` 和 `browser-debug.json`。`pnpm test:unit`（Node 52、组件 5、合同 21、脚本 22 项）、当时的 Mock Playwright 入口（22 通过、2 个真实 Supabase 用例按配置跳过）、`pnpm lint`、`pnpm check:docs`、`pnpm check:routes` 和 `git diff --check` 通过；四个视觉基线此前连续三次比较均为 4/4。该次 BrowserSkill 调试记录有一条 Vue Router deprecation warning，导航和数据更新成功，未观察到运行时错误。

## 运行器异常清理与诊断隔离复查

- 2026-10-07 后续复查确认 supervisor 孤儿清理、启动期间取消、Supabase 部分启动失败、stop 失败后删除工作目录、Playwright 产物目录共享五项意见均成立。
- 修正：正常退出与 supervisor 孤儿恢复共用 BrowserSkill/进程/Vite listener/Supabase/凭据清理管线；按 PID identity 与 owner marker 验证进程，先发送 SIGTERM、等待退出，再必要时 SIGKILL 并复核。Supabase start 前持久化 `stackMayExist`；stop 未确认成功时保留项目目录和诊断路径。启动阶段收到取消只设置标记，当前异步阶段和并行 readiness checks 收敛后才清理。Mock、Local Auth、Visual 分别写入 `test-results/{mock,local-auth,visual}` 和 `playwright-report/{mock,local-auth,visual}`。
- 调试证据完整性与资源清理状态分开记录。只要发现 BrowserSkill 捕获，就先持久化调试 JSON 必需标记，再停止捕获；截图和调试导出会核对文件存在且非空。Session 已停止后的重试也按持久化的必需证据重新验证，不能把上次导出失败移入历史后报 `Pass`；证据未完整时将产品 `Pass` 降为 `Unknown`，即使资源清理已成功。
- 故障注入覆盖启动中取消、readiness sibling 取消、部分 Supabase 启动后清理、supervisor 已退出/ PID 复用判断、孤儿清理、SIGTERM 无效后 SIGKILL、SIGKILL 后仍存活、stop 失败保留项目目录及恢复重试、调试导出失败后 session 关闭仍阻止验收 Pass。大多数故障由依赖注入单测模拟；另一次指定 BrowserSkill 实例的集成运行 `703fb424-3a2e-4f23-9b86-c66af66e8f2e` 在 supervisor SIGKILL 后完成孤儿恢复，报告为 `cleanupStatus=Succeeded`、`evidenceStatus=Complete`，且未遗留登记 PID、BrowserSkill Session、临时目录或该 project ID 的容器。未在真实 Supabase 栈上注入 Docker stop 失败。诊断目录用 Mock 与 Visual 实际运行验证；Local Auth 目录由同一配置 helper 和 runner 环境变量确定，本轮未连接当前 Supabase 项目运行真实 Auth 流程。
- 本轮验证：`pnpm test:unit`（前端 Node 52、组件 5、Deno CORS 3、合同 21、脚本 39 项）、当时的 Mock Playwright 入口（22 通过、2 个真实 Supabase 用例按配置跳过）、`pnpm test:visual`（4 通过）、`pnpm typecheck`、`pnpm lint`、`pnpm check:docs`、`pnpm check:routes` 和 `git diff --check` 通过。未触发远程 GitHub Actions。
