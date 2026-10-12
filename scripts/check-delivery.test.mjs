import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkDelivery } from "./check-delivery.mjs";

const deliveryDoc = `# Delivery

## 发布顺序
## 迁移失败
## 密钥、邮件与域名
## 备份恢复
## 故障诊断

See docs/delivery.md.
`;

async function writeFixture(root, { productionEnv = "VITE_PUBLIC_PATH=/\n" } = {}) {
  await mkdir(join(root, "docs/agent-environment"), { recursive: true });
  await mkdir(join(root, "specs"), { recursive: true });
  await mkdir(join(root, ".github/workflows"), { recursive: true });
  await mkdir(join(root, "frontend"), { recursive: true });
  await mkdir(join(root, "supabase/migrations"), { recursive: true });
  await writeFile(join(root, "docs/delivery.md"), deliveryDoc);
  await writeFile(join(root, "specs/architecture.md"), "See docs/delivery.md.\n");
  await writeFile(join(root, "docs/agent-environment/ci-parity.md"), "See docs/delivery.md.\n");
  await writeFile(join(root, "AI_ENVIRONMENT.md"), "See docs/delivery.md.\n");
  await writeFile(join(root, "package.json"), JSON.stringify({
    scripts: { "check:delivery": "node scripts/check-delivery.mjs" }
  }));
  await writeFile(join(root, ".github/workflows/ci.yml"), "run: pnpm check:delivery\n");
  await writeFile(join(root, "frontend/.env.example"), "VITE_PUBLIC_PATH=/\n");
  await writeFile(join(root, "frontend/.env.development.example"), "VITE_PUBLIC_PATH=/\n");
  await writeFile(join(root, "frontend/.env.staging.example"), "VITE_PUBLIC_PATH=/\n");
  await writeFile(join(root, "frontend/.env.production.example"), productionEnv);
  await writeFile(join(root, "supabase/migrations/20261012000000_ok.sql"), "-- ok\n");
}

test("delivery check rejects a server secret in any env example", async t => {
  const root = await mkdtemp(join(tmpdir(), "delivery-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFixture(root, { productionEnv: "VITE_SUPABASE_SECRET=sb_secret_syntheticmarker\n" });
  const result = await checkDelivery(root);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("frontend/.env.production.example")));
});

test("delivery check accepts env examples without a server secret", async t => {
  const root = await mkdtemp(join(tmpdir(), "delivery-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFixture(root);
  const result = await checkDelivery(root);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});
