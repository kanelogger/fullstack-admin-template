# 前端首批迁移评审修复

## 评审结论

1. Token 刷新失败会让所有等待队列保持 pending。用单一共享 refresh Promise 比手工维护 resolve/reject 回调队列更小，也能让 Axios 自然传播失败。
2. `initRouter` 手工 Promise 只 resolve、不 reject；改为 async 函数并在登录与初始路由恢复调用点处理失败。
3. 首页在 overview 为空时将失败渲染成零统计和“暂无公告”；加明确的 error 状态，保留已有成功数据并在刷新失败时提示数据为上次成功结果。
4. shadcn `--primary` 固定色与平台可配置的 `EpThemeColor` 脱节；在读取 platform config 后设置共享 CSS token，避免直接耦合 Element Plus 内部色值。
5. Input prop 允许 number、emit 却只发 string；支持 `type="number"` 和 Vue `.number` modifier。

## 修复与复核

- Token 刷新使用按会话版本和 refresh token 隔离的共享 Promise。登录和退出递增本地 Session 版本；刷新写回时同时校验版本和 Cookie 中仍是发起刷新的 token，重放请求前再次校验。退出或换账号后旧响应不会恢复旧 token、登出新账号或清理新刷新任务。刷新结果无效或当前会话遇到 401/403 时拒绝所有等待请求并清理失效 Session。
- 动态路由初始化改为 async，错误向上传递；登录初始化失败会清除新建的 Session，路由恢复失败会退出到登录页。
- 首页增加加载失败与重试状态；已有成功数据的刷新失败时保留旧数据并明确提示。
- shadcn 主色在平台配置加载后从 `EpThemeColor` 读取；暗色主色基于同一 token 派生。
- Input 按 `type=number` 与 `.number` modifier 发出 number，否则发出 string。
- `pnpm typecheck`、`pnpm build` 和 `git diff --check` 通过；隔离浏览器中登录页正常渲染。

## 未覆盖

鉴权链路必须继续做真实浏览器验证。当前 backend `.env` 与依赖不存在、3000 端口未监听；没有登录请求、动态菜单请求或首页数据请求可执行。未使用测试账号或修改数据库。匿名拦截、已登录路由、刷新失败重试和 Input 数字值只经类型/代码检查，未做真实链路验证。

## 复评追加：刷新与会话变更竞态

复评发现共享刷新 Promise 仍可能在登出或切换账号后写回旧 Token。通过 Session 版本号、当前 Cookie refresh token 校验、刷新任务按会话隔离以及重放前复核关闭该窗口。`pnpm typecheck`、`pnpm build` 通过；隔离浏览器仍能打开登录页。后端环境未配置，因此慢刷新并发场景未做真实端到端验证。

## 复评追加：Access Token Cookie 已过期

`TokenKey` Cookie 的寿命与 Access Token 一致，正常刷新时该 Cookie 可以已经消失。刷新写回现在始终核对 Session 版本、本地持久化的 refresh token 和 `multiple-tabs` 活跃标记；只有 `TokenKey` Cookie 仍存在时才比较其 refresh token。这样兼容正常过期，同时登出会因版本/会话标记变化被拒绝，跨标签退出或换账号会因 Cookie/持久化 token 不匹配被拒绝。类型检查和构建通过，登录页浏览器检查通过；未连接本地后端，正常刷新分支仍未进行真实请求验证。
