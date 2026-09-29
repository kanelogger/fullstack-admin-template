# 环境命令

命令目录、依赖和权限以 [`project.yml#commands`](../../project.yml) 为准。运行前确认命令存在、工作目录正确、依赖已安装、网络和审批条件满足；运行后记录退出码、产物和清理结果。

## 安装

| ID | 命令 | 工作目录 | 前置条件 | 网络 | 副作用 |
| --- | --- | --- | --- | --- | --- |
| `install.frontend` | `pnpm install` | `frontend/` | pnpm `>=9` | 需要访问包仓库 | `frontend/node_modules/` |
| `install.backend` | `npm install` | `backend/` | Node/npm | 需要访问包仓库 | `backend/node_modules/` |

仓库没有根级锁文件；安装行为以对应目录的 `package.json` 为准。安装依赖后应刷新 [`AI_ENVIRONMENT.md`](../../AI_ENVIRONMENT.md) 中前后端依赖状态。

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

`backend/db/schema.sql` 含有 `DROP TABLE IF EXISTS`，属于破坏性初始化；`backend/db/seed.sql` 会写入默认数据。仅对专用本地数据库执行，并在 `project.yml#permissions.require_human_approval` 要求的人工批准后运行：

```bash
mysql --host=localhost --port=3306 --user=<local-user> --password < backend/db/schema.sql
mysql --host=localhost --port=3306 --user=<local-user> --password < backend/db/seed.sql
```

命令中的密码必须由 MySQL 客户端交互读取或由本地安全机制提供，禁止写入脚本、Prompt、日志或仓库文件。客户端和服务状态按 [能力探测](capabilities.md) 重新检查，结果写入本地 `.agents/state/`。

## 验证记录

每次验证把命令、工作目录、退出码、关键输出、依赖/服务版本、生成物和清理结果写入当前工作区的 `.agents/state/evidence/`；该目录不入库。没有 `test`、`lint` 或 E2E 脚本时，不得把 `typecheck`、构建或普通 HTTP 探测描述为 E2E。
