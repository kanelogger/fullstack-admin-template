# Fullstack Admin Template

面向 PC 浏览器的 Vue 管理后台模板。应用使用 Vue 3、Vue Router、Pinia、shadcn-vue、Tailwind CSS v4、VueUse、TypeScript、Vite、pnpm 和 Zod；Supabase 提供 PostgreSQL、Auth、Storage、Realtime 与 Edge Functions。项目使用单一根 pnpm workspace，不包含独立 Node/Fastify/MySQL 服务。

后台支持垂直、横向和混合导航。横向菜单超出可用宽度时提供左右滚动控件，并在切换路由后把当前菜单项滚入视口。

组织管理支持多级部门：编辑部门时可选择上级部门，列表显示完整层级路径；数据库限制循环关系、失效上级引用和仍有子部门的父级删除。

## UI 开发

先复用 `frontend/src/components/ui/` 中的官方 shadcn-vue 组件；缺少组件时按 `frontend/components.json` 使用 `pnpm dlx shadcn-vue@latest add <component>`，不要套用 React CLI。编辑弹窗用 Dialog，确认操作用 AlertDialog，数据列表用 Table，表单用 Field 与对应控件；菜单、弹层和 Toast 使用库组件。业务代码保留数据与权限逻辑，交互行为由组件库处理。

## 本地启动

环境要求：Node.js `>=22.13.0`，推荐使用项目锁定的 Node 24.18.0 与 pnpm 12.3.4。macOS 本地 Supabase 使用 OrbStack 或兼容 Docker API 的容器 runtime。

从模板创建新项目副本时，在首次启动 Supabase 前运行：

```sh
pnpm template:select-migrations -- --track baseline
pnpm template:init -- --project-id my-admin --title "My Admin"
```

轨道和项目标识只在首次配置时选择。本地 `project_id` 长度为 3–40，以小写字母开头，只含小写字母、数字和连字符；Supabase CLI 会截断更长的 ID，初始化会直接拒绝。Docker 状态无法读取，或发现当前/目标 project ID 的本地状态与数据卷时，命令会拒绝修改。已有数据库项目继续使用原 migration 轨道。

```sh
pnpm install
pnpm supabase:start
pnpm setup:admin
pnpm dev
```

`pnpm setup:admin` 仅在本机 Supabase 尚无首位管理员时创建模板管理员。首次初始化默认登录账号为 `admin`，密码为 `admin123456`；邮箱使用本地占位地址 `admin@example.test`。已有本地管理员不会被改名或重设密码，命令会拒绝创建第二个首位管理员；此时使用现有凭据，或通过登录页的密码恢复流程改密。不要为获取默认凭据重置含有数据的本地数据库。

`pnpm dev` 会启动 Supabase Edge Functions 与 Vite，并从当前 Supabase Local 项目读取本地 URL 和 publishable key。查看脱敏后的连接状态运行 `pnpm supabase:status`。数据库重置命令 `pnpm supabase:db:reset` 会清空当前 Supabase Local 数据库，只能用于确认可丢弃的本地项目。

## 验证

日常改动先运行以下最小检查（无需启动数据库）：

```sh
pnpm check:docs
pnpm check:routes
pnpm check:test-architecture
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

`pnpm format:check` 按 `.prettierrc.json` 检查 `frontend/src/**/*.{vue,ts}`，CLI 生成的 `frontend/src/components/ui/` 由 `.prettierignore` 排除；`pnpm format` 用同一范围写入。Markdown 与设计文档不参与格式化。

涉及 UI 时运行 pnpm test:browser；涉及登录或数据访问时运行 pnpm test:browser:local。前置条件见环境命令。check:test-architecture 核对 Playwright 白名单与 CI 配置；真实 BrowserSkill 证据用 pnpm test:agent:verify 核对。



```sh
pnpm typecheck
pnpm lint
pnpm check:docs
pnpm check:routes
pnpm check:test-architecture
pnpm format:check
pnpm build
pnpm test:unit
pnpm test:components
pnpm test:browser
pnpm test:visual
pnpm test:browser:local
pnpm test:db
pnpm check:migrations
pnpm check:migration-upgrades
```


Visual 在固定 Linux amd64 Playwright 容器内比较 14 个像素状态：登录双主题、Dashboard 三布局双主题、用户表格双主题、Profile 表单双主题和角色授权弹窗双主题。`pnpm test:visual:update` 只在临时固定副本生成候选、原图和差异图；检查候选后运行 `pnpm test:visual:accept -- --candidate <id>` 才会更新登记的正式 PNG。CI 只比较。

真实 BrowserSkill 验收覆盖 Dashboard、消息与壳、组织、配置、身份与导航、附件、审计和 Profile 八个场景。Codex CLI 模式通过 `--browser` 绑定指定实例；runner 会执行 `bsk session start --browser <instance-id> --json`，随后从固定副本启动场景：

```text
pnpm test:agent:start -- --scenario <scenario> --browser <instance-id>
```


每个必需检查点用 pnpm test:agent:record 记录观察结果和证据。cleanup 导出截图和 browser-debug.json 并停止本次 session；verify 核对单个场景或明确提供的八场景报告集合。

## 架构资料

- [设计文档、目标架构与验收](docs/diagram/architecture.md)
- [当前实施说明与设计对照](docs/diagram/architecture-implementation.md)
- [当前架构与接口事实](specs/architecture.md)
- [本地命令与副作用](docs/agent-environment/commands.md)
- [环境服务](docs/agent-environment/services.md)
- [测试约定](rules/testing.md)
