# Fullstack Admin Template

全栈管理后台模板：Vue 3 + Element Plus 前端、Fastify + MySQL 后端，提供认证、动态路由、组织与权限、字典、配置、消息、附件和日志等基础模块。

## 快速开始

### 环境要求

- Node.js：满足 `frontend/package.json#engines`，即 `^20.19.0 || >=22.13.0`
- pnpm：`>=9`（前端）
- MySQL：`8.0+`，用于后端 API
- Windows 开发时，前端脚本中的 POSIX `NODE_OPTIONS=...` 需要在 Git Bash 中运行，或使用等价的 POSIX 兼容环境。

### 后端

1. 复制 `backend/.env.example` 为 `backend/.env`，填写本机 JWT 密钥和 MySQL 连接信息。
2. 在 MySQL 中创建目标数据库，并按顺序执行 `backend/db/schema.sql`、`backend/db/seed.sql`。
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

## Agent 工作入口

- [AGENTS.md](AGENTS.md)：项目级角色、边界和最小验证入口。
- [AI_ENVIRONMENT.md](AI_ENVIRONMENT.md)：按任务路由环境事实，不保存凭据或机器隐私。
- [project.yml](project.yml)：命令、写入范围、权限和工作流契约。
- [rules/](rules/)：按需加载的测试、安全和 Git 规则。
- [specs/architecture.md](specs/architecture.md)：当前架构与接口事实。
- [docs/agent-environment/](docs/agent-environment/)：服务、能力、网络和 CI 对齐资料。
- [.agents/skills/agents-maintenance/SKILL.md](.agents/skills/agents-maintenance/SKILL.md)：仅在维护 Agent 规则时加载。

## 当前范围

仓库包含本地开发所需的前后端源码、数据库 Schema 和 Seed。生产部署、CI、E2E、MCP 连接和外部系统写入尚未在本模板中定义；相关任务先补充事实与审批边界，再执行。
