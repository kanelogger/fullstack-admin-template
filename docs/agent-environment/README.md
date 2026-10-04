# Agent 环境资料

本目录保存按任务加载的环境事实。根目录 [`AI_ENVIRONMENT.md`](../../AI_ENVIRONMENT.md) 负责路由，命令和权限以 [`project.yml`](../../project.yml) 为准。

| 任务 | 资料 |
| --- | --- |
| 执行、修改或注册命令 | [`commands.md`](commands.md) |
| 启动、停止或排查服务 | [`services.md`](services.md) |
| 判断可用工具、Skill 或权限 | [`capabilities.md`](capabilities.md) |
| 网络、沙箱、文件系统或 GUI | [`network-filesystem.md`](network-filesystem.md) |
| 对齐本地、CI 和发布环境 | [`ci-parity.md`](ci-parity.md) |
| 配置本机 Node、Python、registry 和 Docker 工具链 | [`local-toolchain.md`](local-toolchain.md) |

## 维护规则

- 每项机器事实都记录证据、验证时间、刷新条件和状态；过期事实不能直接作为执行依据。
- 不记录密钥、令牌、客户数据或个人账户；只记录变量名和安全存在性。
- 运行命令前确认工作目录、依赖、权限、网络、审批和副作用；运行后记录退出码和清理结果。
- 当前仓库的 Playwright 覆盖登录控件和消息中心列表/详情/已读界面（消息响应使用隔离 mock）；Supabase Local pgTAP/`test:db` 覆盖消息 read model、RLS、Realtime 和密码/恢复会话。真实邮件链接浏览器回调、Fastify bridge 与其余模块 CRUD E2E 仍待验收。CI、发布配置和外部连接也未配置。补齐后同步更新 `AGENTS.md`、`project.yml` 和相关章节。
