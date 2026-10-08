# 验收输入摘要与 project ID 完整性

- 状态：进行中
- 目标：修复三项审阅发现，避免 project 标签截断、验收 runner/fixture/启动输入漂移及 suite 摘要漏测。
- 评估：三项都成立。Supabase CLI v2.119.0 将 project ID 规范到 40 字符；旧 runner 对 `identity-navigation` 生成 42 字符。BrowserSkill 摘要把整个 runner 前缀归为可漂移管理输入；suite 摘要又从预筛后的 Browser 文件清单计算，漏掉 Vitest 配置和部分 Node 测试。
- 实施：生成并校验不超过 40 字符的 project ID；按 product/scenario/management/ledger 明确分区，场景 runner/账号/fixture/启动配置变化让 Browser 报告失效；suite 摘要从完整 Git 文件清单筛选。
- 当前验收：新八场景报告在当前产品与场景执行摘要下通过统一 verify，34 个 checkpoint 全部通过，历史报告摘要未改写；逐断言引用已更新到这些实际报告。最终 unit 执行在用户转入清理任务时被中断，unit 记录保留原摘要并标为 Stale，测试架构最终门槛尚未收口。
- 清理（2026-10-09）：按用户要求关闭 6 个旧隔离栈的 Edge CLI 残留进程；确认 Docker 无容器、BrowserSkill 无活动 Session；删除 14 个旧临时运行目录、22 个调试文件、41 份过期报告、视觉候选、Playwright 输出和构建输出，删除未被命令或测试调用的一次性断言刷新脚本。仅保留当前八场景的必需验收证据及正式基线。当前 Local 数据卷与无关服务保留。
- Git：当前工作区只有 main，无本轮分支待合并；另一个 detached 基线 worktree 含其他轮次未提交改动，未动。按用户要求准备本地提交，不推送。
- 下一步：在后续验收任务中取得当前完整 unit 输入下的通过结果，再执行测试架构最终检查；本次清理和提交不替代这一门槛。
