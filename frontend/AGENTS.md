# 范围

管理后台前端：Vue 3 + Vue Router + Pinia + shadcn-vue + Tailwind CSS v4 + VueUse，使用 Vite 7 构建，负责全部页面、路由、状态与 HTTP 封装。UI 正在分阶段从 Element Plus 迁移；当前应用壳和未迁移页面仍依赖 Element Plus 及既有 PureAdmin 派生工具。

## 局部约束

- 包管理器固定 `pnpm`（>=9）。
- shadcn-vue 组件源码位于 `src/components/ui/`，主题变量与 Tailwind CSS v4 入口位于 `src/style/tailwind.css`，配置位于 `components.json`。
- 新增 shadcn-vue 组件可运行 `pnpm dlx shadcn-vue@latest add <component>`，生成源码放入本仓库维护。
- 新页面优先使用 `src/components/ui/` 中的 shadcn-vue 组件和 Tailwind 工具类；迁移旧页面时保持 API、路由权限和业务行为不变。
- `dev`/`build` 脚本内联 `NODE_OPTIONS=...`（POSIX 写法）；Windows cmd 不识别，本机用 Git Bash 运行，或改用 cross-env 等价写法。
- 所有后端请求走 `/api` 前缀，经 `src/utils/http/index.ts` 封装；dev 代理由 `vite.config.ts` 转发到 `http://localhost:3000`。
- 环境变量按 `.env.example`、`.env.development.example` 复制为本地 `.env*`；真实文件不提交。

## 按需指南

- 权限指令（`v-perms`/`v-auth`）：`src/directives/`
- 布局与多标签：`src/layout/`、`src/store/modules/multiTags.ts`
