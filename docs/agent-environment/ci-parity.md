# 本地、CI 与发布环境对齐

| 维度 | Local | CI | Release |
| --- | --- | --- | --- |
| workflow | 根 `package.json`、`project.yml` | `.github/workflows/ci.yml` | 未配置 |
| 系统 | 当前开发机，以本轮能力探测为准 | GitHub Actions `ubuntu-latest` | 不适用 |
| Node / pnpm | Node `>=22.13.0`、pnpm `>=9`；锁定 24.18.0 / 12.3.4 | 同版本，使用 frozen lockfile | 不适用 |
| 数据库 | Supabase Local / Postgres 17 | `check:migrations` 动态创建隔离本地 Supabase project | 不适用 |
| Browser suite | PC Chromium / Playwright，产物 `test-results/browser` 与 `playwright-report/browser` | 安装 Chromium 与系统依赖，诊断单独上传 | Session 竞态、权限导航和完整路由布局矩阵 |
| Browser Local Auth | 本地 Supabase/Mailpit，产物位于 `browser-local` 子目录 | 临时迁移栈检查后独立上传 | 恢复、真实登录、CRUD、Realtime、刷新与旧 token RLS 拒绝 |
| Visual baseline | Linux amd64 Playwright 1.63.0 Noble container, pinned by image digest；产物位于 `visual` 子目录 | 固定容器内调用 `pnpm test:visual`，只比较正式基线 | 14 个登录、Dashboard、用户表格、Profile 与角色授权状态；CI 不生成或接受候选 |
| BrowserSkill scenarios | Harness 指定实例、固定源码副本、run 专属 Supabase project | 不在 CI 自动运行；每次由调用者显式启动并提供 Harness Session ID | 八个业务场景的真实交互与证据；输入摘要不匹配时报告不可用于删除 |
| 质量步骤 | typecheck、build、unit、browser/local Auth、db 集成 | 冻结安装、docs/route/test-architecture 检查、lint、typecheck、build、unit、browser、14 状态视觉比较、历史 replay、双轨升级 | 不适用 |

CI 的静态步骤以仓库中的 workflow 文件为准；远程执行状态只由对应 GitHub Actions run 证明。维护本文时更新运行环境和步骤配置，不记录易过期的分支、提交或最近一次运行状态。

当前没有发布或生产部署配置，不推断生产域名、密钥、数据库、备份或发布命令。
