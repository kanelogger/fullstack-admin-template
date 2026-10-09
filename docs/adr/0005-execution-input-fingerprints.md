# 0005. 场景执行输入与测试 suite 完整摘要

- 日期：2026-10-08
- 状态：生效
- 背景：继续审阅发现三处 false Pass：Supabase CLI 会把超过 40 字符的 project ID 截断，清理代码仍用原 ID 查资源；管理摘要把整个 BrowserSkill runner、账号/fixture 准备和启动逻辑排除在严格输入匹配之外；suite 摘要只筛选已经过 BrowserSkill 规则筛选的文件，遗漏 Vitest 配置与部分 Node 测试。
- 决策：
  - BrowserSkill 临时 project ID 由场景 slug 和 64-bit 随机后缀构成，总长不超过 CLI 的 40 字符限制。清理 helper 拒绝长 ID，防止 CLI 与 Docker 查询使用不同标签。
  - BrowserSkill 摘要分为产品输入、场景执行输入、验收管理输入和断言账本。验收 runner、账号/fixture 准备、启动脚本/配置、Supabase 配置、seed 和场景规则都进入严格 scenario digest；产品与 scenario digest 都匹配才允许复用报告。管理 drift 仅限明确 allowlist 中的验证/记录工具和 Playwright 层代码，账本单独跟踪。
  - Unit 与 Browser suite hash 从完整 Git 文件清单中筛选，包括 tracked 和未忽略的 untracked 文件。Unit 覆盖 Vitest 配置、Node 测试及 `scripts/` 支持输入；Browser 覆盖 Playwright 配置、活动 spec、helpers 和运行器。断言账本不参与自身 suite hash。
  - 历史报告摘要不可回写。执行输入变化会使旧报告验证失败；只有新实测报告能恢复当前场景状态。
- 备选方案与否决原因：
  - 在清理查询时重复 `slice(0, 40)` 会把原 ID 与 CLI 实际 ID 的差异隐藏在多个调用点；改为生成时规范并在 helper 边界拒绝过长 ID。
  - 继续使用宽泛 `startsWith("scripts/agent-testing")` 分类会使账号、fixture 和启动逻辑任意改变而保持旧报告有效；改为显式的 scenario 输入集合和较窄管理 allowlist。
  - 继续从 BrowserSkill 摘要的 `files` 字段计算 suite hash 无法发现该摘要本来排除的单测文件；从完整 Git 清单筛选 suite 输入。
- 证据：
  - Supabase CLI v2.119.0 的 `sanitizeProjectId` 定义 40 字符上限并截断；当前 `identity-navigation` runner ID 为 42 字符。见 [v2.119.0 CLI config source](https://raw.githubusercontent.com/supabase/cli/v2.119.0/apps/cli-go/pkg/config/config.go#L1217-L1225)。
  - 回归测试覆盖 40 字符 ID 生成、42 字符 ID 在 stop/检查前拒绝、scenario runner/account/startup 输入漂移拒绝报告、Vitest 配置与 Node 测试变化更新 unit digest。
  - 八份旧报告保留原文件；新严格场景摘要拒绝复用 runner、生命周期和 migration startup 输入已变化的旧 run。当前八场景重验状态记录在下方收口记录。
- 关联：本决策取代 [ADR 0004](0004-acceptance-evidence-integrity.md) 对管理 drift 与产品报告复用范围的描述，保留其逐断言、证据归属和清理资源后置条件。

## 收口记录（2026-10-09）

- `pnpm test:unit` 退出码 0：73 个前端单元、9 个组件、3 个 Deno、21 个合同、74 个 Node 测试全部通过，无跳过。当前完整 unit 输入摘要为 `e76df1c5b04e0d68fbe495b336c8dc92d73a40b54f1db62a01e21a21f8df0451`；运行期间未修改输入，结束后再次核对一致，并据实更新逐断言账本中的 suite 记录。
- `pnpm check:test-architecture` 退出码 0、`valid: true`：6 类 active spec、9 个 retired spec、无待退出 spec；12 个旧用例的 113 条断言替代映射通过当前输入门槛。
- 八场景现存报告重新执行 `pnpm test:agent:verify`，退出码 0、`valid: true`，34/34 checkpoint 通过，证据归属、固定副本及清理结果有效。产品摘要为 `5f3f433f6b8b138e3ff44dd4a0a394572e362df62828f9f577390f2ecec9439e`，场景执行摘要为 `e9abf3b9433ebd75efdb68762a921f07f46a69932e2588f7dc3ad94bd269ed6e`；验证工具与账本 drift 按规则单独报告，未改写历史报告。
- Playwright 的已有通过记录仍匹配当前产品及 browser suite 输入：14 passed、2 个按配置跳过的 Local Auth 用例。本次补齐 unit 门槛并验证现存 BrowserSkill 证据，未重跑浏览器交互、Local Auth 或视觉基线。

| 场景 | 当前有效 run ID | checkpoint |
| --- | --- | ---: |
| `dashboard` | `f18363bc-be30-42e5-9f8a-b02863f5d42a` | 4/4 |
| `messages-shell` | `f14ee074-17fb-49c3-8bf8-0046ee6656a7` | 4/4 |
| `organization` | `d501e023-a1d5-4fd0-b177-8efea6589901` | 4/4 |
| `configuration` | `28879bc1-8813-425b-8a35-25896d881ceb` | 4/4 |
| `identity-navigation` | `2d3f7032-bbce-4a8c-bc31-1a4169546d45` | 7/7 |
| `attachments` | `0610393c-31ff-42c1-81d0-967fa22e50f2` | 4/4 |
| `audit` | `99e18f42-e2ce-47a3-b8a4-6e6153ef3a36` | 4/4 |
| `profile` | `dfd2e60c-6c0f-4ff4-8d46-b6b84a32230a` | 3/3 |

- 2026-10-09 清理已保留当前八场景必需证据与正式视觉基线，移除旧临时目录、过期报告、调试及构建产物；工作区 Local 数据卷和无关服务保留。本次收口未启动或重置数据库，未创建提交或推送。
- Playwright + BrowserSkill 测试迁移的本地最终门槛已通过；BrowserSkill 继续由 Agent 显式运行，远程 CI 的实际执行结果不在本次验收范围内。
