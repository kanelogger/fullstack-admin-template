# 网络、工作区与本地状态

适用范围：本仓库及其各检出目录；负责人：项目维护者。静态来源为 `project.yml`、`.gitignore`、`frontend/vite.config.ts` 和 `backend/src/config/index.ts`，核实于 2026-09-29。工作区、代理、权限或服务配置变化时刷新；主机网络、GUI 和沙箱权限状态为 `unknown`，按任务探测。

## 定位与隔离

1. 从当前目录执行 `git rev-parse --show-toplevel` 定位当前检出根。从子目录进入也按该根解析项目相对路径；不要用 `git-common-dir` 定位写入目录。
2. 非 Git 的复制项目，向上寻找同时包含 `AGENTS.md` 和 `project.yml` 的目录。找不到锚点时先解决项目定位，避免写入其他项目。
3. `project.yml#workspace.project_identity` 是模板上游的稳定身份；独立 fork/复制成新项目时改为其自己的仓库标识。同一项目的 worktree 共用身份，但项目资源、本地状态均写入各自检出根。
4. 每次写入前确认当前根和目标归属。不要从另一 worktree 的 `.agents/state/` 恢复 owner、锁、端口或凭据。

## 文件边界

| 信息 | 位置与处理 |
| --- | --- |
| 当前事实与稳定流程 | `specs/`、`rules/`、`.agents/skills/`，随实现更新并入库 |
| 可审计任务与讨论 | `tasks/`、`workflow/`，按需求记录来源、验收、状态和结论并入库 |
| 长期决策 | `docs/adr/`，保留原因、证据和替代关系 |
| 阶段、锁、缓存、环境探测、原始验证日志 | `.agents/state/` / `.agents/cache/`，被 `.gitignore` 排除 |
| 凭据 | 本地 `.env*`；只提交 `*.example` 样例，不记录实际值 |
| 依赖与产物 | `node_modules/`、`dist/`、日志、上传文件均被忽略；不要清理用户已有资源 |

## 状态写入协议

`.agents/state/workflow.json` 是可选的本地恢复提示，不是任务事实或授权源。任务事实以 `tasks/` 为准；没有该文件时仍恢复进行中或阻塞的任务。冲突、多个任务或无任务时按 [任务恢复规则](../../tasks/README.md) 处理。

- 字段至少包含 `schema_version`、`project_id`、`workspace_id`（当前根的稳定本地标识）、`owner`（会话标识）、`revision`、`stage`、`active_task`（任务相对路径或 null）、`updated_at`。读取时先核对项目与工作区，缺少归属字段的旧状态需重新生成。
- 同一工作区由一个 owner 写共享阶段。并发 Agent 使用独立 worktree，或使用 `.agents/state/sessions/<owner>/` 的独立状态，不能共同覆盖共享文件。
- 共享写入用排他创建的锁文件 `.agents/state/workflow.lock` 确认归属；锁已存在则停止写入并交由其 owner 处理，不自动删除未知锁。持锁后再次核对 owner、workspace 和 revision，再写同目录临时文件并 rename 替换，成功后递增 revision，最后释放自己持有的锁。
- 原子替换只防止半写文件，不能解决并发覆盖；不得省略单写者、锁和版本检查。任务完成时设 `stage: idle`、`active_task: null`，可审计结论保留在任务记录中。

## 网络

安装依赖访问包管理器指定的 registry；代理、认证和证书由本机配置提供，不把配置值复制到仓库。单次命令需要切换源时用命令参数，不修改全局设置。

Vite 开发代理指向 `http://localhost:3000`，后端 MySQL 地址取自本地环境变量。前后端监听配置均可能绑定所有网卡，执行前按任务选择合适的绑定地址；`local` profile 不等于仅监听回环地址。

外部系统写入、生产写入、发布和破坏性操作遵循 [安全规则](../../rules/security.md)。已有授权覆盖具体动作时直接按范围执行。
