import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkTestArchitecture,
  parseCheckTestArchitectureArgs
} from "./check-test-architecture.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

async function copyRelative(relativePath, targetRoot) {
  const target = join(targetRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(repositoryRoot, relativePath), target);
}

test("parseCheckTestArchitectureArgs defaults to ci and accepts acceptance", () => {
  assert.deepEqual(parseCheckTestArchitectureArgs([]), { mode: "ci" });
  assert.deepEqual(parseCheckTestArchitectureArgs(["--", "--mode", "acceptance"]), { mode: "acceptance" });
  assert.throws(() => parseCheckTestArchitectureArgs(["--mode", "release"]), /--mode must be one of/);
});

test("ci mode passes without current BrowserSkill or suite digests", async () => {
  const result = await checkTestArchitecture(repositoryRoot, { mode: "ci" });
  assert.equal(result.mode, "ci");
  assert.equal(result.browserskillEvidenceRequired, false);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(
    result.errors.some(error => /BrowserSkill report|product digest is stale|suite is missing a current passing/.test(error)),
    false
  );
});

test("acceptance mode still requires matching BrowserSkill and suite digests", async () => {
  const result = await checkTestArchitecture(repositoryRoot, { mode: "acceptance" });
  assert.equal(result.mode, "acceptance");
  assert.equal(result.browserskillEvidenceRequired, true);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /Assertion verification product digest is stale/);
  assert.match(result.errors.join("\n"), /missing a passing current-source BrowserSkill report: dashboard/);
  assert.match(result.errors.join("\n"), /suite is missing a current passing result: pnpm test:unit/);
});

test("ci mode rejects an acceptance archive that omits gate=acceptance-only", async () => {
  const fixtureRoot = await mkdtemp(join(os.tmpdir(), "check-test-architecture-"));
  try {
    const trackedPaths = [
      "package.json",
      ".github/workflows/ci.yml",
      "frontend/playwright.config.ts",
      "scripts/test-architecture-rules.json",
      "scripts/test-architecture-assertions.json"
    ];
    for (const path of trackedPaths) await copyRelative(path, fixtureRoot);

    const e2eSource = join(repositoryRoot, "frontend/e2e");
    const e2eTarget = join(fixtureRoot, "frontend/e2e");
    await mkdir(e2eTarget, { recursive: true });
    for (const file of [
      "auth-recovery-local.spec.ts",
      "dashboard-visual.spec.ts",
      "default-admin-login-local.spec.ts",
      "navigation-authorization.spec.ts",
      "session-race.spec.ts",
      "visual-route-review.spec.ts"
    ]) {
      await writeFile(join(e2eTarget, file), await readFile(join(e2eSource, file)));
    }

    // Replacement targets referenced by the retirement ledger must exist for structural coverage.
    const replacementPaths = [
      "frontend/e2e/visual-route-review.spec.ts",
      "frontend/e2e/navigation-authorization.spec.ts",
      "frontend/e2e/session-race.spec.ts",
      "frontend/e2e/auth-recovery-local.spec.ts",
      "frontend/e2e/default-admin-login-local.spec.ts"
    ];
    for (const path of replacementPaths) {
      await mkdir(dirname(join(fixtureRoot, path)), { recursive: true });
      await writeFile(join(fixtureRoot, path), await readFile(join(repositoryRoot, path)));
    }

    // Copy every replacement file named in the ledger so structural coverage can resolve tests.
    const manifest = JSON.parse(await readFile(join(fixtureRoot, "scripts/test-architecture-assertions.json"), "utf8"));
    const coveragePaths = new Set();
    for (const testCase of manifest.cases) {
      for (const assertion of testCase.assertions) {
        for (const coverage of assertion.coverage ?? []) {
          if (coverage.path) coveragePaths.add(coverage.path);
        }
      }
    }
    for (const path of coveragePaths) {
      const source = join(repositoryRoot, path);
      const target = join(fixtureRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(source));
    }

    delete manifest.verification.gate;
    await writeFile(
      join(fixtureRoot, "scripts/test-architecture-assertions.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    const result = await checkTestArchitecture(fixtureRoot, { mode: "ci" });
    assert.equal(result.valid, false);
    assert.match(
      result.errors.join("\n"),
      /Assertion verification archive must declare gate=acceptance-only/
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
