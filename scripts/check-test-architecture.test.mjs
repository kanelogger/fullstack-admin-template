import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkTestArchitecture } from "./check-test-architecture.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

async function copyRelative(relativePath, targetRoot) {
  const target = join(targetRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(repositoryRoot, relativePath), target);
}

test("current Playwright allowlist and CI wiring pass", async () => {
  const result = await checkTestArchitecture(repositoryRoot);
  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.deepEqual(result.errors, []);
});

test("unregistered Playwright specs fail the structure gate", async t => {
  const fixtureRoot = await mkdtemp(join(os.tmpdir(), "check-test-architecture-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  for (const path of [".github/workflows/ci.yml", "frontend/playwright.config.ts", "scripts/test-architecture-rules.json", "package.json"]) {
    await copyRelative(path, fixtureRoot);
  }
  const e2e = join(fixtureRoot, "frontend/e2e");
  await mkdir(e2e, { recursive: true });
  await writeFile(join(e2e, "unexpected.spec.ts"), "test('unexpected', () => {});\n");
  const result = await checkTestArchitecture(fixtureRoot);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /outside the active allowlist/);
});
