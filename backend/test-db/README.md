# 专用 MySQL 测试库

此目录只服务本模板的本地开发和迁移验收。Compose 使用独立项目、独立数据卷与 `127.0.0.1:3307`；不会连接占用 3306 的其他项目 MySQL。

## 首次准备

确认 OrbStack 或其他 Docker 运行时已启动，然后从仓库根目录执行：

```bash
cd backend && npm install --no-package-lock
cd ..
cd frontend && pnpm install
cd ..
node backend/test-db/setup.mjs prepare
node backend/test-db/setup.mjs up
node backend/test-db/setup.mjs init
node backend/test-db/setup.mjs status
node backend/test-db/setup.mjs preflight
```

`prepare` 生成被 Git 忽略的 `backend/test-db/.env`，随机生成 MySQL 与 JWT 密钥；仅当 `backend/.env` 不存在时，创建指向该测试配置的本地软链接。已有 `.env` 不会被覆盖。`init` 先核对 Compose 项目、回环端口、数据库名、时区以及目标库为空，才依次执行 `backend/db/schema.sql` 和 `backend/db/seed.sql`；非空库会被拒绝。Schema 本身含删表语句，因此不要把它导入其他数据库。

MySQL 固定使用 `+08:00`，消息回填预览应显式传入 `--source-timezone +08:00`。`status` 会检查 `CONVERT_TZ`、表和 Seed 数量；`preflight` 在只读事务里执行仓库现有的账号与消息预检 SQL，只输出汇总计数。两者都不输出口令或密码哈希。预检不能证明邮箱归属。

若 Supabase Local 正在运行，可将本项目的 publishable key 直接写入忽略的本地配置，而不在终端打印密钥：

```bash
node backend/test-db/setup.mjs sync-supabase-key
```

当前本机 `backend/node_modules` 中的 TypeScript 7 与 ts-node 10 不兼容。下面的入口使用前端已固定的 TypeScript 5.9，并为旧 CommonJS 默认导入启用互操作编译选项；不改动两个项目的依赖清单。它只在 `backend/.env` 指向专用测试配置时启动：

```bash
node backend/test-db/run-backend.mjs
```

停止容器可执行：

```bash
docker compose --env-file backend/test-db/.env -f backend/test-db/compose.yaml down
```

这条停止命令保留数据卷；本目录不提供自动删除或重置数据卷的命令。

## 测试账号边界

MySQL Seed 提供 `superadmin`、`operator`、`common` 三条业务用户记录、角色与动态菜单。Seed 中的旧 MD5 密码仅用于遗留数据，不是当前应用可用的登录凭据：Fastify `/login` 已停用。完整登录验收还需要在 Supabase Local 创建对应 Auth 用户、确认邮箱归属并回填相同 BIGINT 业务 ID；在映射完成前不能把 MySQL Seed 当作真实登录通过的证据。
