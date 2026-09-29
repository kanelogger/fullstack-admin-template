# 环境服务

服务配置以代码和 `.env.example` 为事实源。启动前检查已有实例，测试创建的数据库、文件和进程必须按验证记录清理。

## 前端 Vite

| 项目 | 内容 |
| --- | --- |
| 用途 | Vue 3 管理后台开发服务器 |
| 配置来源 | `frontend/vite.config.ts`、`frontend/.env*.example` |
| 启动 | 在 `frontend/` 执行 `pnpm dev` |
| 停止 | 停止对应 Vite 进程 |
| 地址 | `http://localhost:8848`，端口由 `VITE_PORT` 控制 |
| 依赖 | 前端依赖；登录和接口场景还需要后端与 MySQL |
| 健康检查 | `curl -f http://localhost:8848/`，再用浏览器打开受影响页面 |
| 数据与清理 | Vite 缓存和 `dist/` 不入库；停止进程即可 |

## 后端 Fastify

| 项目 | 内容 |
| --- | --- |
| 用途 | 认证、动态路由和管理模块 API |
| 配置来源 | `backend/src/config/index.ts`、`backend/.env` |
| 启动 | 在 `backend/` 执行 `npm run dev` |
| 停止 | 停止对应 Fastify/nodemon 进程 |
| 地址 | `http://localhost:3000`，端口由 `PORT` 控制 |
| 依赖 | 后端依赖、`backend/.env`、MySQL 8.0+ |
| 健康检查 | `curl -f http://localhost:3000/captcha`；仓库没有独立 `/health` 路由 |
| 数据与清理 | 日志、上传文件和运行缓存不入库；测试数据按 `rules/testing.md` 清理 |

`/captcha` 是认证路由中免登录的 GET 接口，适合作为进程存活探测；它不替代登录、鉴权和数据库完整链路验证。

## MySQL

| 项目 | 内容 |
| --- | --- |
| 用途 | 持久化用户、权限、业务、消息和审计日志 |
| 配置来源 | `backend/.env`、`backend/db/schema.sql` |
| 启动/停止 | 由本机 MySQL 安装或服务管理器负责；仓库没有服务编排文件 |
| 地址 | 默认 `localhost:3306` |
| 健康检查 | 在安装 `mysqladmin` 后执行 `mysqladmin ping --host=localhost --port=3306 --user=<local-user> --password` |
| 初始化 | 先执行 `schema.sql`，再执行 `seed.sql`；`schema.sql` 会删除并重建表，需人工批准 |
| 数据与清理 | 使用专用本地数据库；重置或删除数据属于破坏性操作，需人工批准 |

仓库没有 MySQL 服务健康的静态证据；启动前按 [能力探测](capabilities.md) 检查客户端、服务连接和当前工作区的数据库归属。初始化或重置数据库仍属于破坏性操作，需人工批准。
