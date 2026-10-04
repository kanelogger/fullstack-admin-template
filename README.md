# Fullstack Admin Template

全栈管理后台模板：Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse 前端，Fastify + MySQL 后端，提供认证、动态路由、组织与权限、字典、配置、消息、附件和日志等基础模块。前端页面按模块逐步从 Element Plus 迁移到 shadcn-vue；侧栏、顶栏、面包屑、多标签、搜索、通知及已迁移页面使用新栈，剩余旧页面仍使用 Element Plus 与既有 PureAdmin 派生工具。

## 快速开始

### 环境要求

- Node.js：满足 `frontend/package.json#engines`，即 `>=22.13.0`
- pnpm：`>=9`（前端）
- 推荐使用 Volta；项目锁定 Node 24.18.0、前端 pnpm 12.3.4、旧后端 npm 12.0.2。
- Python 开发使用 pyenv；机器学习使用单独的 Miniconda 环境 `environment.ml.yml`。
- MySQL：`8.0+`，用于后端 API
- 本地 Supabase 使用 OrbStack 或其他 Docker-compatible runtime；配置、迁移与开发密钥样例已建立。
- Windows 开发时，前端脚本中的 POSIX `NODE_OPTIONS=...` 需要在 Git Bash 中运行，或使用等价的 POSIX 兼容环境。

### 后端

1. 复制 `backend/.env.example` 为 `backend/.env`，填写本机 JWT 密钥和 MySQL 连接信息；Auth bridge 使用的 Supabase URL/publishable key 从本地栈状态中配置。
2. 创建与本地 `MYSQL_DATABASE` 一致的专用本地数据库，按 [数据库初始化指南](docs/agent-environment/commands.md#数据库初始化) 显式指定目标库，依次导入 Schema 和 Seed。Schema 会删除并重建表；执行前须确认目标并获得批准。
3. 安装并启动：

   ```bash
   cd backend
   npm install
   npm run dev
   ```

后端默认监听 `http://localhost:3000`。

### 前端

1. 按需将 `frontend/.env.example`、`frontend/.env.development.example` 复制为本地 `.env*` 文件。
2. 安装并启动：

   ```bash
   cd frontend
   pnpm install
   pnpm dev
   ```

前端默认监听 `http://localhost:8848`，开发环境将 `/api` 代理到后端 3000 端口。

### Supabase Local（迁移目标）

1. 确认 OrbStack 或兼容 Docker API 的 runtime 正在运行。
2. 在 `frontend/` 执行 `pnpm install` 和 `pnpm run supabase:start`。
3. 本地项目配置、migration、seed 与 CLI 脚本位于仓库的 `supabase/` 和前端 package scripts。重建本地数据库使用 `pnpm run supabase:db:reset`，它会清空本项目 Supabase Local 数据后重放 migrations/seed。

应用登录入口只支持账号 + 密码；邮箱只用于密码重置，公共注册关闭，应用不提供短信/邮箱验证码、魔法链接、OAuth、SSO 或 Passkey 登录。浏览器登录必须经过 Edge Function 的账号映射和 Session 登记；RLS 与 Fastify bridge 拒绝未登记的 Auth Session。Supabase Email Provider 的底层 OTP 能力保留给密码恢复，恢复 Session 不能访问业务数据。个人资料、消息中心、用户、角色、菜单、组织、字典、系统配置、附件、三类审计日志和仪表盘页面已切到 Supabase；菜单表仅接收固定 RouteKey，应用动态路由由 Supabase `current_navigation()` 按 RLS 权限返回，Fastify `async-routes` 和既有 MySQL 写日志仅作为旧客户端兼容期来源。审计页显示 Supabase 中的登录与已迁移模块事件；迁移期外部旧客户端的新 MySQL 日志尚未汇入 Supabase。仪表盘指标按各模块读取权限显示，常见指标来自当前 Profile、消息、操作和异常日志。残余 Element Plus/PureAdmin 共享组件仍待迁移。附件使用 private bucket，审计读取需 `audit.logs.read`，上传/删除权限分开校验。当前专用测试库附件与三类日志预览均无历史行。消息实时推送只向收件人开放。专用合成 MySQL 测试库的 3 个账号、4 条消息、2 个部门、4 个岗位、3 个字典类型、9 个字典项和 6 条配置已导入 Supabase Local；真实账号/邮箱所有权和远程数据没有导入，MySQL 菜单授权关系也尚未回填。Supabase 本地 key 只用于开发，浏览器变量只能使用 publishable key，不得放入 service-role/secret key。

## Agent 工作入口

- [AGENTS.md](AGENTS.md)：项目级角色、边界和最小验证入口。
- [AI_ENVIRONMENT.md](AI_ENVIRONMENT.md)：按任务路由环境事实，不保存凭据或机器隐私。
- [project.yml](project.yml)：命令、写入范围、权限和工作流契约。
- [rules/](rules/)：按需加载的测试、安全和 Git 规则。
- [specs/architecture.md](specs/architecture.md)：当前架构与接口事实。
- [docs/agent-environment/](docs/agent-environment/)：服务、能力、网络和 CI 对齐资料。
- [本机开发工具链](docs/agent-environment/local-toolchain.md)：Volta、yrm、pnpm/npm、pyenv/conda、OrbStack 的项目用法。
- [Supabase 本地服务](docs/agent-environment/services.md#supabase-local)：启动、停止、端口与本地数据库重建边界。
- [Supabase 本地服务](docs/agent-environment/services.md#supabase-local)：启动、停止、端口与本地数据库重建边界。
- [.agents/skills/agents-maintenance/SKILL.md](.agents/skills/agents-maintenance/SKILL.md)：仅在维护 Agent 规则时加载。

## 当前范围

仓库包含本地开发所需的前后端源码、数据库 Schema 和 Seed。常规 Playwright 16 项覆盖账号密码登录、应用壳、消息、用户、角色/菜单、组织、字典/配置、附件、三类审计日志、仪表盘和导航权限，业务 API 使用隔离 fixtures/mock；真实本地 Auth 用例另通过 Mailpit 邮件链接完成 SPA 密码恢复、账号密码登录和本人资料读取。`pnpm test:auth-bridge` 验证 Supabase→Fastify/MySQL 旧 JWT 桥接及有效/无效刷新令牌。Supabase Local 的 413 项 pgTAP、Edge、审计、dashboard RLS、Storage、Realtime 和导入验收已通过。刷新期间退出/切换账号的真实慢请求和剩余 CRUD E2E 仍待验收。CI、生产部署、MCP 连接和外部系统写入尚未在本模板中定义。
