# 环境命令

命令目录、依赖和权限以 [`project.yml#commands`](../../project.yml) 为准。运行前确认命令存在、工作目录正确、依赖已安装、网络和审批条件满足；运行后记录退出码、产物和清理结果。

## 安装

| ID | 命令 | 工作目录 | 前置条件 | 网络 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| `install.frontend` | `pnpm install` | `frontend/` | Volta 固定 Node/pnpm，或满足 Node `>=22.13.0` 与 pnpm `>=9` | 需要访问包仓库 | `frontend/node_modules/`、`frontend/pnpm-lock.yaml` |
| `install.backend` | `npm install` | `backend/` | Node/npm | 需要访问包仓库 | `backend/node_modules/` |

仓库没有根级包清单；前端 lockfile 为 `frontend/pnpm-lock.yaml`，后端暂未提交 npm lockfile。安装行为以对应目录的 `package.json` 为准；本机依赖状态按 [能力探测](capabilities.md) 重新核实，不写回版本化索引。

## 开发与构建

| ID | 命令 | 工作目录 | 预期结果 | 清理 |
| --- | --- | --- | --- | --- |
| `develop.frontend` | `pnpm dev` | `frontend/` | Vite 监听 8848 | 停止 Vite 进程 |
| `develop.backend` | `npm run dev` | `backend/` | Fastify 监听 3000 | 停止 Fastify/nodemon 进程 |
| `typecheck.frontend` | `pnpm typecheck` | `frontend/` | `tsc` 与 `vue-tsc` 退出 0 | 无 |
| `typecheck.backend` | `npm run typecheck` | `backend/` | `tsc` 退出 0 | 无 |
| `build.frontend` | `pnpm build` | `frontend/` | 生成 `frontend/dist/` | 删除本次生成的 `dist/` |
| `build.backend` | `npm run build` | `backend/` | 生成 `backend/dist/` | 删除本次生成的 `dist/` |

Windows 下前端 `dev`、`build` 脚本使用 POSIX 环境变量写法；使用 Git Bash 或等价环境执行。不要通过修改命令来掩盖脚本与 shell 的不兼容，应在验证报告中记录实际 shell。

## 数据库初始化

`backend/db/schema.sql` 含有 `DROP TABLE IF EXISTS`，属于破坏性初始化；`backend/db/seed.sql` 会写入默认数据。两份 SQL 均不负责建库或选择数据库。仅对已确认归属的专用本地数据库执行，并在 `project.yml#permissions.require_human_approval` 要求的人工批准后运行；不要对已有业务库试跑。

1. 按 `backend/.env.example` 准备本地配置。核对 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_USER` 和 `MYSQL_DATABASE`，确保指向本次获准使用的本地库。
2. 如果目标库尚不存在，由有建库权限的本地账号连接该 MySQL 实例并创建。例如下面的 SQL 创建 `admin_template_local`；实际库名可自定，但必须与本地 `MYSQL_DATABASE` 一致。已有数据库先确认归属，不重复创建。

   ```sql
   CREATE DATABASE `admin_template_local` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

3. 从仓库根目录执行下面的 Bash 命令。先把所有 `<MYSQL_...>` 占位符替换为本地配置的对应值（保留引号），不要直接执行占位符。显式使用 `--database`，不依赖客户端默认库；先确认 Schema 导入成功，再导入 Seed：

   ```bash
   mysql --host='<MYSQL_HOST>' --port='<MYSQL_PORT>' --user='<MYSQL_USER>' --password --database='<MYSQL_DATABASE>' < backend/db/schema.sql &&
   mysql --host='<MYSQL_HOST>' --port='<MYSQL_PORT>' --user='<MYSQL_USER>' --password --database='<MYSQL_DATABASE>' < backend/db/seed.sql
   ```

命令中的密码必须由 MySQL 客户端交互读取或由本地安全机制提供，禁止写入脚本、Prompt、日志或仓库文件。客户端和服务状态按 [能力探测](capabilities.md) 重新检查，结果写入本地 `.agents/state/`。

## Auth 账号预检

切换 Supabase Auth 前，先对确认归属的旧 MySQL 源库执行 `backend/db/preflight-auth-accounts.sql`。它只读输出活跃账号的缺失/异常邮箱、大小写归一后的重复 login_name/邮箱、Postgres BIGINT 与旧 Fastify JS number 的 ID 上限冲突及候选用户列表。结果集必须先由账号管理员处理；还要逐个确认邮箱归属且已验证后，才允许创建 Supabase Auth 用户并回填 `profiles.auth_user_id`。此预检 SQL 不验证远端邮箱，脚本也不会创建或修改账号。

消息历史回填前，对同一确认归属的 MySQL 源库运行 `backend/db/preflight-messages.sql`。它只读检查消息数量、收发件人映射缺失、Postgres signed BIGINT 上限、消息类型分布、已读时间异常和 MySQL 时区设置；SQL 不读取消息正文，也不修改源库。时区和映射结果未确认前不得导入 Supabase。

消息映射规则可离线验证：`cd backend && npm run test:migration:messages` 不连接数据库或输出真实消息数据。

`cd backend && npm run migrate:messages -- --confirm-source-database <数据库名> --source-timezone <时区>` 默认执行只读预览；MySQL host 必须是本机回环地址，数据库名必须与本地 `MYSQL_DATABASE` 一致，时区必须与预检结果匹配。检查完整预览并确认目标为当前项目的 Supabase Local 后，再加 `--apply-local`。该模式分批导入、以 BIGINT `id` 幂等跳过完全相同的现有行，冲突会中止；脚本只对 MySQL 运行 `SELECT` 和只读事务，不会删除或更新源数据。不要提供远程 Supabase URL/key，工具会拒绝非本地 API 地址。

## 组织、账号关系与字典/配置数据回填

先运行只读 `backend/db/preflight-organization.sql` 和 `backend/db/preflight-dictionary-configuration.sql`，确认 MySQL 库名、时区、signed BIGINT 边界、重复业务键和关系完整性。映射规则可离线检查：`cd backend && npm run test:migration:organization && npm run test:migration:dictionary-configuration`。

`cd backend && npm run migrate:organization -- --confirm-source-database <数据库名> --source-timezone <时区>` 默认只读预览。确认结果后加 `--apply-local`，它只向本项目 Supabase Local 插入部门/岗位，保留源 BIGINT ID、状态、逻辑删除和时间戳。账号 profile importer 在写入前还会通过 service_role RPC 检查所有 `department_id/post_id` 已存在，因此组织行须先回填；账号回填后运行 `frontend/` 下的 `supabase db query --local --file supabase/scripts/validate_organization_profile_constraints.sql` 验证并启用两个外键约束。此验证器在发现未解析引用时会拒绝运行。

账号与邮箱迁移见上方 Auth 预检；`backend/scripts/migrate-auth-accounts.mjs` 是独立受控入口，真实账号 apply 还需要操作者确认邮箱归属。字典/系统配置需在 profile actor IDs 已映射后运行 `cd backend && npm run migrate:dictionary-configuration -- --confirm-source-database <数据库名> --source-timezone <时区>`；先只读预览，核对 3 类数据后加 `--apply-local`。导入按字典类型→字典项→系统配置顺序执行，保留 BIGINT 字符串、审计用户、软删除状态与时间戳，并拒绝冲突。两个 importer 都只读访问本机 MySQL，只能写入 `localhost:54321` 的 Supabase Local，默认不会写数据。

附件历史数据在用户 Profile 映射完成后运行 `cd backend && npm run test:migration:attachments` 检查离线映射规则，再执行 `npm run migrate:attachments -- --confirm-source-database <数据库名> --source-timezone <时区>`。导入器先只读扫描 MySQL 与 `backend/uploads/attachments`，核对文件大小、signed BIGINT、Profile 引用和时区；默认只预览，只有传 `--apply-local` 才把文件上传到当前项目 `admin-attachments` 私有 bucket 并幂等插入元数据。目标路径使用固定 legacy 前缀，已有对象必须与源文件 SHA-256 一致；导入程序绝不写 MySQL，也拒绝远程 Supabase。当前专用测试库预览为 0 条附件。

历史审计日志迁移先运行只读 `backend/db/preflight-audit-logs.sql`，再用 `cd backend && npm run test:migration:audit-logs` 检查 ID、时区和敏感值脱敏规则。`npm run migrate:audit-logs -- --confirm-source-database <数据库名> --source-timezone <时区>` 默认只读预览；只有传 `--apply-local` 才向当前 Supabase Local 导入登录、操作和异常日志。超出 signed BIGINT 或字段约束的日志会拒绝导入；旧操作人 ID 若没有对应 Profile，会置空并保留旧名称快照；请求参数中的密码、Token、Authorization 等敏感键会脱敏，过大的 JSON 参数以安全摘要替代。此流程只写本地 Supabase，不会写 MySQL 或远程项目。当前专用测试库三类日志预览均为 0 行。

## Supabase Local

Supabase CLI 作为前端项目的精确版本开发依赖安装，配置和 migrations 位于仓库根目录 `supabase/`。先启动 OrbStack，再在 `frontend/` 执行 `pnpm run supabase:start`。检查状态用 `pnpm run supabase:status`；停止本地服务用 `pnpm run supabase:stop`，这会保留 Supabase 本地数据库卷。

`pnpm run supabase:db:reset` 会删除并重建当前项目的本地 Supabase 数据库，再按顺序重放 migration 和 seed。仅对本项目的 disposable local stack 执行；先核实端口与项目归属，并遵循 `project.yml#permissions.require_human_approval`。绝不使用带 `--linked` 的 reset 处理远程数据库。

`pnpm run test:db` 会从本地 `supabase status` 在进程内读取 service-role key，创建隔离的 Auth/RLS 角色、消息、附件和审计 fixture，运行 pgTAP，验证密码/恢复会话、消息 read model/RLS/Realtime 与跨收件人隔离、私有附件 Storage 读写权限、审计 RLS/变更事件/日志导入幂等和 dashboard 角色数据范围，并捕获 forced-reset 邮件。最后删除临时 Auth 用户、Profile、角色关系、Storage 对象、附件元数据、登录/操作日志、消息和对应 Mailpit 邮件。脚本只接受 `127.0.0.1`/`localhost:54321` API，并始终使用 `test db --local`；不要改成从远程 project 读取 key 或数据。

Supabase Local 默认在 54321（API）、54322（Postgres）、54323（Studio）和 54324（邮件捕获器）监听。认证邮件只进入本地 Mailpit，不会真实发信。变量样例见 [`frontend/.env.example`](../../frontend/.env.example)；只把 publishable key 放到 `VITE_*`，service-role/secret key 只能留在服务端环境。

## 验证记录

每次验证把命令、工作目录、退出码、关键输出、依赖/服务版本、生成物和清理结果写入当前工作区的 `.agents/state/evidence/`；该目录不入库。没有 `test`、`lint` 或 E2E 脚本时，不得把 `typecheck`、构建或普通 HTTP 探测描述为 E2E。
