# 生产交付约定

本仓库是模板，CI 不连接生产项目，也不保存生产密钥。派生项目发布时按同一 Git 修订执行下面的顺序。`pnpm check:delivery` 检查这份约定仍在，CI 没有生产发布命令，并且工作区里的 `.env*` 文件没有服务端密钥。它不审计源码或文档中的说明文字。

## 发布顺序

一次发布只包含一个 Git 修订，数据库、Edge Functions 和前端都来自该修订。

1. 确认该修订已通过当前仓库的 CI。
2. 备份目标数据库。
3. 把该修订的 migration 应用到目标数据库。Supabase 托管项目使用 `supabase db push`；它只执行尚未入账的 migration。
4. 部署该修订的 Edge Functions。
5. 用 `pnpm build` 构建前端，并发布生成的 `frontend/dist/`。浏览器只注入该环境的 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_PUBLISHABLE_KEY`。
6. 用浏览器源站对 Edge Function 发一次预检。响应里的 `Access-Control-Allow-Origin` 必须是该源站，不能是 `null`。

后一步使用前一步已经成功的修订。不要用新的前端或函数去访问尚未迁移的数据库，也不要让旧前端依赖新 migration 才存在的列或函数。

## 迁移失败

`supabase db push` 失败时停止本次发布，目标环境继续运行上一修订的函数和前端。

已进入 migration 账本的文件保持原样。修复时新增 migration，不修改已经应用的文件，也不使用 `DROP ... CASCADE` 清掉业务数据。失败发生在账本更新之前时，先确认目标库没有半截对象，再从同一修订重新执行 push。

本地可丢弃库用 `pnpm check:migrations` 验证 migration 能从空库重放。该命令使用临时项目，不连接生产库，也不重置当前正在使用的本地库。

## 密钥、邮件与域名

| 名称 | 所在位置 | 可以进入浏览器 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | 前端构建环境 | 可以 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 前端构建环境 | 可以 |
| `VITE_PUBLIC_PATH` | 前端构建环境 | 可以，只表示静态资源前缀 |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions 运行环境 | 不可以 |
| `APP_ORIGIN` | Edge Functions 运行环境 | 不可以；密码重置邮件用它生成回跳地址 |
| `APP_ALLOWED_ORIGINS` | Edge Functions 运行环境 | 不可以；CORS 白名单，多个源站用逗号分隔 |

服务端密钥不写入 `VITE_*`，不写入任何 `.env*` 文件，也不进入 Git。Auth 邮件由目标 Supabase 项目的 SMTP 配置发送；本地开发仍由 Mailpit 接收。浏览器源站要同时写入 `APP_ALLOWED_ORIGINS`、目标项目的 Site URL 与重定向白名单，以及前端的 `VITE_PUBLIC_PATH`。`APP_ORIGIN` 只决定密码重置邮件的回跳地址，不参与 CORS。只配置 `APP_ORIGIN` 时，函数会把 `Access-Control-Allow-Origin` 返回为 `null`，浏览器登录请求会被拒绝。

## 备份恢复

发布 migration 前先做逻辑备份。恢复演练使用一份可丢弃的数据库，不覆盖正在服务的库。演练通过的标准是：备份能够恢复，恢复后的库包含恢复点之前的 migration 账本，并且用该修订的前端和函数可以登录、读取授权页面。恢复后的库不作为新的生产库继续写入，除非这次演练的目的就是故障切换，并且写入窗口已经明确。

## 故障诊断

发布后先看三类记录：Supabase Auth 日志、Postgres 日志，以及 Edge Function 日志。业务侧的登录、操作和异常记录在审计表中，页面只显示当前账号有权读取的行。登录失败、函数返回 5xx，或 migration 之后出现缺列错误时，停止后续发布，按「迁移失败」处理数据库，并保留该修订的日志。
