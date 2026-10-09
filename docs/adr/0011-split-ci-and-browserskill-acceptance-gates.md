# 0011. 基础 CI 与 BrowserSkill 验收门禁拆分

- 日期：2026-10-09
- 状态：生效
- 背景：开发期把八场景 BrowserSkill 通过报告、产品/场景/suite 摘要写入 `scripts/test-architecture-assertions.json`，并由 `pnpm check:test-architecture` 在每次 push/PR 上要求它们匹配当前源码。产品任意改动都会使已提交账本失效；CI 本身不跑 BrowserSkill，也无法自动重写报告，PR 只能靠人工重跑八场景才能变绿。交互式业务验收不应成为普通 CI 债务。
- 决策：
  - `pnpm check:test-architecture`（`--mode ci`）只检查结构：Playwright 白名单、待退出/已退出登记、逐断言映射结构、替代测试/检查点引用是否存在、CI workflow 不含 acceptance 门禁。不要求产品/场景/suite 摘要或八场景报告匹配当前源码。
  - `pnpm check:test-architecture:acceptance`（`--mode acceptance`）保留完整证据新鲜度门槛：账本中的 unit/browser suite 通过记录与八场景 BrowserSkill 报告必须匹配当前产品与场景摘要。发布/Agent 验收显式调用该命令，或直接使用 `pnpm test:agent:verify`。
  - 历史验证账本 `verification.gate` 固定为 `acceptance-only`。CI 模式若缺少该标记则失败，防止把过期账本当成“当前已验收”。
  - 普通 PR CI（`.github/workflows/ci.yml`）继续跑 lint、format、typecheck、unit、browser、migration、visual 等可自动执行的检查；不跑、也不宣称 BrowserSkill 通过。
- 备选方案与否决原因：
  - 继续刷新八场景报告让 CI 变绿：把交互验收绑在每次源码改动上，债务随场景增加而放大。
  - 删除整个 `check:test-architecture`：会丢掉 Playwright 白名单与退休登记等仍有价值的结构门槛。
  - 让 CI 自动跑 BrowserSkill：依赖人工浏览器/Harness，不稳定且与现有“显式启动”协议冲突。
- 证据：
  - `scripts/check-test-architecture.mjs` 支持 `--mode ci|acceptance`；`scripts/check-test-architecture.test.mjs` 覆盖默认 CI 通过、acceptance 仍拒绝过期摘要、缺少 `gate=acceptance-only` 时 CI 失败。
  - 关联：本决策收窄 [ADR 0005](0005-execution-input-fingerprints.md) 中“`check:test-architecture` 与当前输入摘要绑定”对普通 CI 的适用范围；摘要与报告复用规则对 acceptance / `test:agent:verify` / `test:agent:retire` 仍然有效。
