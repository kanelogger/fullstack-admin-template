# 网络、工作区与本地状态

适用范围：本仓库及各独立检出目录。工作区归属、网络和文件权限按本轮环境探测；不要继承旧会话的端口、锁、服务状态或授权。

## 项目定位

1. 从当前目录运行 `git rev-parse --show-toplevel` 定位检出根；写入路径按当前 checkout 解析。
2. 非 Git 复制项目向上寻找同时包含 `AGENTS.md` 和 `project.yml` 的目录。
3. 每次写入前核对目标相对当前根目录归属；不能从其他 worktree 的 `.agents/state/` 恢复运行态信息。

## 文件边界

| 内容 | 位置 |
| --- | --- |
| 当前架构、安全与验证规则 | `specs/`、`rules/` 和项目 Agent 规则 |
| 需求状态与结论 | `tasks/`、`docs/adr/` |
| 阶段、锁、测试日志和探测状态 | `.agents/state/`，已忽略 |
| 凭据 | 本地 `.env*`；只提交 example 文件 |
| 依赖与产物 | `node_modules/`、`dist/`、logs、Playwright results、Supabase Local state |

## 状态写入协议

`.agents/state/workflow.json` 是可选的本地提示，不是任务事实或授权源。任务事实以 `tasks/` 为准；任务恢复见 [`tasks/README.md`](../../tasks/README.md)。共享 workflow 状态至少包含 `schema_version`、`project_id`、`workspace_id`、`owner`、`revision`、`stage`、`active_task` 和 `updated_at`。读取时核对项目与当前 checkout；缺归属字段的旧状态需重建。

- 一个 checkout 同一时间只有一个共享状态 owner。并发 Agent 使用独立 worktree 或 `.agents/state/sessions/<owner>/` 私有状态。
- 写入前用排他创建取得 `.agents/state/workflow.lock`。锁存在时停止写入，不能自动清除未知 owner 的锁。
- 持锁后重新读取 JSON 并比对 owner、workspace 和 revision；仅当仍由自己持有且 revision 未变化时写入。
- 先写同目录临时文件，再 rename 原子替换；成功后增加 revision 并释放自己持有的锁。临时文件原子替换不能代替单写者和版本校验。
- 完成任务时更新 `stage: idle`、`active_task: null`；可审计结论保存到 `tasks/` 或 `docs/adr/`。

## 网络与服务

依赖安装通过 pnpm 配置的 registry 访问包仓库；代理、证书与凭据由本机配置提供，不把认证信息写入仓库。Local Vite 监听 8848，Supabase Local 使用 `supabase/config.toml` 中的端口。本地 host 或端口要与配置核对后再运行。

外部写入、生产写入、发布和破坏性操作遵循 [`rules/security.md`](../../rules/security.md)。
