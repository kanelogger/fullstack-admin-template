# 环境命令

所有应用命令从仓库根目录运行，以根 `package.json` 与 `pnpm-lock.yaml` 为准。Node 要求 `>=22.13.0`，pnpm 要求 `>=9`；项目固定 Node 24.18.0 / pnpm 12.3.4。

## 安装、开发与构建

| 用途 | 命令 | 前置条件与结果 |
| --- | --- | --- |
| 新项目选 migration 轨道 | `pnpm template:select-migrations -- --track baseline` | 首次启动 Supabase 前运行；归档旧历史、物化固定基线和共同增量并保存轨道标记。已有项目不可换轨；本地状态、容器/数据卷存在或 Docker 探测失败时拒绝修改 |
| 配置新项目 | `pnpm template:init -- --project-id <id> --title <title> [--dry-run]` | 设置 Supabase project ID 和浏览器标题；dry-run 与实际执行共用变更集。存在恢复日志或残留备份时，dry-run 只报告待恢复路径且不写文件；实际执行会先恢复。目标文件偏离模板默认值或运行状态无法核实时拒绝；部分写入失败会回滚 |
| 同步 migration 轨道 | `pnpm template:sync-migrations` | 模板维护者按字节镜像 cutoff 后的历史增量；已选 baseline 的项目只添加缺失的共享增量，不覆盖固定基线或已有 migration |
| 冻结安装 | `pnpm install --frozen-lockfile` | 根 workspace 安装 Vue 应用、共享合同、Supabase CLI 与 Deno 工具；锁文件无漂移 |
| Supabase Local | `pnpm supabase:start` | OrbStack 或兼容 Docker runtime 启动本地 Postgres、Auth、Storage、Realtime、Edge 与 Mailpit |
| 开发 | `pnpm dev` | Supabase Local 已运行；同时启动 Edge Function server 和 Vite PC 应用 `127.0.0.1:8848` |
| 文档引用 | `pnpm check:docs` | 检查活动 Markdown 相对链接和 workspace script 引用 |
| 类型检查 | `pnpm typecheck` | 前端 Vue/TypeScript、共享 Zod package、全部 Deno functions |
| 源码 lint | `pnpm lint` | ESLint 检查 Vue/TypeScript、共享合同、脚本；Deno lint 检查 Edge Functions |
| RouteKey 合同 | `pnpm check:routes` | 检查前端注册、菜单元数据、权限键与未忽略的页面导入；CI 另要求页面文件已跟踪 |
| 构建 | `pnpm build` | 生成 `frontend/dist/` |

环境变量示例在 `frontend/.env.example` 与 `frontend/.env.development.example`。本机 Supabase URL/publishable key 可从 `pnpm supabase:status` 获取；输出已剔除服务端密钥。

## 首位管理员

Supabase seed 不含公开默认管理员。`pnpm setup:admin` 只连接本机 Supabase Local，创建唯一首位 SUPER_ADMIN，首次初始化凭据为 `admin` / `admin123456`，邮箱为本地占位地址 `admin@example.test`。已有首位管理员或普通账号不会被改名、升级或重设密码；命令拒绝创建第二个管理员。邮箱冲突或初始化部分失败时命令拒绝升级账号，可安全重试带受信标记的初始化身份。

## 测试与质量

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 单元 | `pnpm test:unit` | Vitest 与本地 helper 测试 |
| PC 浏览器 mock | `pnpm test:e2e:mock` | Playwright Chromium；隔离服务 fixture，不需要 Supabase 数据库 |
| 本地 PC 浏览器全链路 | `pnpm test:e2e:local` | 本地 Supabase/Mailpit 上真实验证 Auth、字典 CRUD、Realtime、刷新、越权拒绝和退出后的旧 token RLS 拒绝 |
| 当前本地数据库 | `pnpm test:db` | pgTAP/Auth/Edge/Storage/Realtime fixtures；清理测试记录，不重置数据库 |
| 完整空库验收 | `pnpm check:migrations` | 唯一临时 project ID 和动态端口，空库 replay、重复 seed、lint/advisors、pgTAP、服务集成、管理员并发、默认凭据创建与 PC 浏览器登录 |
| 双轨数据保留升级 | `pnpm check:migration-upgrades` | 临时基线在最近三条真实增量前生成；历史库和临时基线库保留 SQL fixture、应用同一增量并检查数据/授权/账本/schema manifest。固定发布基线另行验收 |
| 新项目 schema 基线导出 | `pnpm check:migrations -- --baseline-output /private/tmp/template-baseline.sql` | 从完整历史验收库导出候选 SQL，再在第二个隔离空库只重放该 SQL 并完成数据库、Auth、Storage、Realtime 与浏览器验收；全部通过后才原子发布到不存在的目标路径，失败会清理候选文件，不修改当前数据库 |

`check:migrations` 使用临时工作目录并在结束时停止自己创建的栈；它不访问当前 Supabase 项目。测试产生失败时检查 project ID 与 cleanup 结果，不要停止其他容器。

`check:migration-upgrades` 用 `20261004231856` 作为本轮升级演练起点，验证最近 3 个真实增量同时适用于历史库和临时生成基线库；此外从固定发布 cutoff `20261005084413` 验收当前基线。probe 来自独立 fixture，不登记 migration 版本，并在最终 schema 比较前删除。固定基线当前无 cutoff 后增量，随着未来 migration 加入，两轨都会自动应用并比较。

## Supabase Local 管理

- `pnpm supabase:status`：只显示 project ID、API URL、publishable key。
- `pnpm supabase:stop`：停止当前工作区 project 的服务，保留 Local 数据卷。
- `pnpm supabase:db:reset`：清空当前工作区 Local 数据库，再重放 migration 与 seed。执行前确认 project ID、端口及数据库可丢弃；不要用它重置含用户数据的工作栈，也不要连接远端项目。

完整验证结果写入被忽略的 `.agents/state/evidence/`；交付说明区分静态检查、mock browser、真实 Auth 和空库 replay。
