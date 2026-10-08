# 0004. 验收证据归属与旧测试逐断言退出

- 日期：2026-10-08
- 状态：已被 0005 取代
- 背景：全项目测试架构迁移审阅确认四个门槛缺口：Supabase CLI stop 退出码不能证明临时栈已消失；用例级 coverage 被复制到所有 `expect` 时会产生虚假的逐断言映射；debug 证据未绑定 BrowserSkill Session、应用 origin 和时间范围；布局矩阵任意 heading 可见不能证明 RouteKey 对应页面已加载。
- 决策：
  - BrowserSkill、migration 和 upgrade 检查创建的隔离 Supabase 栈都必须先成功执行 stop，再按精确 Docker Compose project label 检查容器、卷和网络。资源检查失败或发现残留时记录清理失败，并保留恢复目录与诊断信息。
  - 旧 Smoke 的每个 `expect` 调用由 AST 解析为独立记录，保存位置、源码片段和 SHA-256 指纹。删除门槛逐项要求具名测试及对应通过摘要、BrowserSkill 场景与 checkpoint 及其 run ID，或明确的保留理由；拒绝旧用例级 coverage 回退。
  - debug 捕获必须唯一，Session ID 与报告一致，捕获 URL origin 与 `appOrigin` 一致，开始/停止/保存时间落在报告运行时间窗内。
  - 产品源码、测试管理输入和断言清单分别摘要。管理/清单变化单独报告，不覆盖历史报告摘要，也不单独使产品证据失效；删除门槛继续独立验证最新断言映射及替代测试通过结果。
  - 全路由 × 三布局 × 双主题矩阵逐 RouteKey 检查预期页面标题，并保留布局、主题、溢出、活动菜单和滚动断言。
- 备选方案与否决原因：
  - 继续只信任 CLI 退出码会把 stop 失败后的残留误记为成功。
  - 继续按用例复用 coverage 会把无对应替代测试的旧断言错误放行。
  - 把 debug 文件存在视为有效证据会允许误拷其他 Session 或站点的捕获。
  - 仅保留任意标题断言会让错 RouteKey 页面通过布局矩阵。
  - 因管理清单变化重跑不受影响的产品验收会增加成本且不补充产品行为证据；因此保留独立摘要与删除门槛。
- 证据：
  - 旧清单已从 12 个用例解析出 113 条断言记录；9 个旧 Smoke spec 经 5 个批次退出，删除门槛仍在 CI 可检查的登记规则中。
  - 当前产品摘要 SHA-256：`dee4785b0da724c656838e358137892214dd9dc0561ae5f72eb4949553a1c56e`。验证器将 `scripts/check-migrations.mjs` 归入管理摘要后，旧报告从已保存文件指纹重算出的产品摘要与当前产品摘要一致。
  - 八场景 BrowserSkill 报告均为 `productStatus=Pass`、`cleanupStatus=Succeeded`，共 34/34 checkpoint；统一 `pnpm test:agent:verify` 返回 `valid: true`。管理输入和断言清单差异单独列出，报告摘要未改写：

| 场景 | BrowserSkill run ID | checkpoint |
| --- | --- | ---: |
| `messages-shell` | `87c11453-36c6-4118-936b-b7642746c909` | 4/4 |
| `organization` | `49864275-3072-427b-bf6b-d62b71fb6b41` | 4/4 |
| `configuration` | `d64e997b-3e64-4d44-895d-ad466061b44a` | 4/4 |
| `identity-navigation` | `a46bbb60-534d-4154-9ad9-d797eea5beef` | 7/7 |
| `attachments` | `dc9718e1-9f99-4e1a-a63c-13da304f7b90` | 4/4 |
| `audit` | `ff1b11b8-616f-4297-8e95-a6030ee45f15` | 4/4 |
| `profile` | `3dbc3dd4-93e3-4b91-b371-ea1bd80b1eed` | 3/3 |
| `dashboard` | `9584f0dc-820e-4d38-99c2-6262afba34f9` | 4/4 |

  - `pnpm test:unit`：73 前端单元、9 组件、3 Deno、21 合同和 69 Node 脚本测试通过。`pnpm test:browser`：14 passed、2 个按配置跳过的 Local Auth 用例。`pnpm lint`、`pnpm check:test-architecture` 通过。
  - 迁移规模记录（2026-10-07 快照）：29 个既有文件改动，982 行新增、328 行删除；18 个新增项目文件约 2,824 行。测试设施包括 8 个场景/34 个检查点、9 个旧 spec/12 个用例/113 条逐断言映射、7 个 Service 测试文件、2 个门槛/候选测试文件和 14 个像素状态；当时累计命令等待约 12 分钟，不含提权审查等待。
  - 清理门槛接入后的最终 `pnpm check:migrations` 通过（345 pgTAP，2 个本地 Auth 浏览器用例）；`template-migration-406ca5a366` 容器、卷、网络均为 0。`pnpm check:migration-upgrades` 的历史、临时基线、发布基线三轨均通过；对应 project `upg-hist-ea69f0c0`、`upg-drill-5cca4e1d`、`upg-base-47d56a84` 的容器、卷、网络均为 0。
  - 最终 BrowserSkill 使用 master `fb5e899d`；清理审计确认实例在线且 0 个活动 Session，八个应用端口及 8848 均无监听。历史未清理栈按报告对应 project ID 清理并核对容器、卷和网络；未修改历史报告。
  - 资源尾查发现旧 upgrade 验收栈 `template-upgrade-published-baseline-6a5f` 残留；按精确 project ID 调用 Supabase CLI 停止后，逐项确认该 ID 下容器、卷、网络均为零。当前工作区 Local 栈和无关 `kit-test` 资源保留。
  - Dashboard 系统概览保持 CSS Grid；视觉候选 `c5e9d416-7791-4894-ba14-961e4305a4fa` 已按用户审阅接受，14 个正式像素状态比较通过。
- 关联：本决策取代 [ADR 0003](0003-full-test-architecture-migration.md) 中关于报告摘要与旧断言映射的实现描述，并与 [测试约定](../../rules/testing.md)、[当前架构](../../specs/architecture.md) 共同定义当前门槛。
