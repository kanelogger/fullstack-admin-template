# Security Rules

- 默认只加载当前需求所需的仓库文件、知识和工具。
- Supabase service-role/secret key、Auth access/refresh token、本机密码、生产数据、客户信息和未脱敏敏感材料不得进入 Prompt、日志、提交物或交接产物；只引用变量名和 example 中的占位写法。
- `.env*`、Supabase Local 状态、上传文件和测试产物已加入 `.gitignore`；发现敏感文件可被提交时先报告再处理。
- 外部系统写入、生产操作、发布和不可逆动作（删除数据、重置当前数据库）必须获得人工批准。`pnpm supabase:db:reset` 只用于确认可丢弃的当前本地栈。
- Auth、RLS、动态菜单和权限变更属于高风险区域：改动后按 `rules/testing.md` 验证公开路由、未登录拦截、授权访问和服务端拒绝未授权请求。
- 发现权限范围与任务不匹配时停止执行，在当前任务中记录阻塞。
