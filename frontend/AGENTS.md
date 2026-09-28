# 范围

管理后台前端：Vue 3 + Vite 7 + Element Plus + Pinia + Tailwind CSS 4，基于 vue-pure-admin，负责全部页面、路由、状态与 HTTP 封装。

## 局部约束

- 包管理器固定 `pnpm`（>=9）。
- `dev`/`build` 脚本内联 `NODE_OPTIONS=...`（POSIX 写法）；Windows cmd 不识别，本机用 Git Bash 运行，或改用 cross-env 等价写法。
- 所有后端请求走 `/api` 前缀，经 `src/utils/http/index.ts` 封装；dev 代理由 `vite.config.ts` 转发到 `http://localhost:3000`。
- 环境变量按 `.env.example`、`.env.development.example` 复制为本地 `.env*`；真实文件不提交。

## 按需指南

- 权限指令（`v-perms`/`v-auth`）：`src/directives/`
- 布局与多标签：`src/layout/`、`src/store/modules/multiTags.ts`
