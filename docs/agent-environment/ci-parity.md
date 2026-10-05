# 本地、CI 与发布环境对齐

| 维度 | Local | CI | Release |
| --- | --- | --- | --- |
| workflow | 根 `package.json`、`project.yml` | `.github/workflows/ci.yml` | 未配置 |
| 系统 | 当前开发机，以本轮能力探测为准 | GitHub Actions `ubuntu-latest` | 不适用 |
| Node / pnpm | Node `>=22.13.0`、pnpm `>=9`；锁定 24.18.0 / 12.3.4 | 同版本，使用 frozen lockfile | 不适用 |
| 数据库 | Supabase Local / Postgres 17 | `check:migrations` 动态创建隔离本地 Supabase project | 不适用 |
| Browser | PC Chromium / Playwright | 安装 Chromium 与系统依赖 | 不适用 |
| 质量步骤 | typecheck、build、unit、mock/local Auth、db 集成 | 冻结安装、typecheck、build、unit、PC mock、完整隔离 migration check | 不适用 |

CI workflow 已创建在当前工作区，尚未暂存或提交；尚无 CI 运行结果的静态文件不能证明远端 job 已通过。push / pull_request job 若因容器权限、端口、系统依赖或运行时差异失败，分别记录为 CI 结果。

当前没有发布或生产部署配置，不推断生产域名、密钥、数据库、备份或发布命令。
