import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { copyFixedWorkspace, repositoryRoot, summarizeInputs } from "./test-architecture.mjs";
import { acceptVisualCandidate, assertVisualBaselinesComplete, createVisualCandidate } from "./visual-baselines.mjs";

const png = suffix => Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from(suffix)]);

async function makeVisualWorkspace() {
  const root = await mkdtemp(join(os.tmpdir(), "visual-baseline-fixture-"));
  const rules = await readFile(join(repositoryRoot, "scripts/test-architecture-rules.json"));
  const testManifest = JSON.parse(await readFile(join(repositoryRoot, "visual/test-manifest.json"), "utf8"));
  testManifest.baselineAdditions = testManifest.states.slice(4).map(state => state.baseline);
  const testManifestBytes = Buffer.from(`${JSON.stringify(testManifest, null, 2)}\n`);
  const files = [
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "project.yml",
    "frontend/package.json", "frontend/index.html", "frontend/vite.config.ts", "frontend/tsconfig.json",
    "frontend/playwright.config.ts", "frontend/scripts/run-playwright.mjs", "scripts/playwright-artifacts.mjs",
    "scripts/test-architecture-rules.json", "supabase/config.toml",
    "supabase/seed.sql", "frontend/e2e/dashboard-visual.spec.ts", "frontend/e2e/visual-route-review.spec.ts",
    "scripts/run-visual-tests.mjs", "scripts/visual-tests-container.sh", "frontend/src/page.ts"
  ];
  for (const path of files) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    const value = path === "scripts/test-architecture-rules.json" ? rules
        : path === "visual/test-manifest.json" ? testManifestBytes : Buffer.from(`fixture ${path}\n`);
    await writeFile(target, value);
  }
  const manifestPath = join(root, "visual/test-manifest.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, testManifestBytes);
  const manifest = testManifest;
  for (const [index, state] of manifest.states.entries()) {
    if (manifest.baselineAdditions.includes(state.baseline)) continue;
    const target = join(root, ...state.baseline.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, png(`original-${index}`));
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

async function prepareCandidate(root) {
  const startingSummary = await summarizeInputs(root, "visual");
  const workspaceRoot = join(dirname(root), `${basename(root)}-fixed-snapshot`);
  const copied = await copyFixedWorkspace(root, workspaceRoot, "visual");
  assert.equal(copied.before.inputSha256, startingSummary.inputSha256);
  const manifest = JSON.parse(await readFile(join(root, "visual/test-manifest.json"), "utf8"));
  for (const [index, path] of manifest.baselineAdditions.entries()) {
    const target = join(workspaceRoot, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, png(`candidate-add-${index}`));
  }
  const changedState = manifest.states.find(state => state.id === "login-light");
  await writeFile(join(workspaceRoot, ...changedState.baseline.split("/")), png("candidate-updated-login-light"));
  const diagnosticsRoot = join(root, "diagnostics");
  await mkdir(diagnosticsRoot, { recursive: true });
  await writeFile(join(diagnosticsRoot, "login-light-expected.png"), png("original-login-light"));
  await writeFile(join(diagnosticsRoot, "login-light-diff.png"), png("diff-login-light"));
  const candidate = await createVisualCandidate({ root, workspaceRoot, diagnosticsRoot, startingSummary });
  return { candidate, workspaceRoot };
}

test("visual candidate acceptance updates only registered targets and clears pending additions", async t => {
  const root = await makeVisualWorkspace();
  const snapshot = join(dirname(root), `${basename(root)}-fixed-snapshot`);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(snapshot, { recursive: true, force: true });
  });
  const existingBaseline = join(root, "frontend/e2e/dashboard-visual.spec.ts-snapshots/login-light-visual-linux-linux.png");
  const originalBaseline = await readFile(existingBaseline);
  const { candidate } = await prepareCandidate(root);
  assert.deepEqual(await readFile(existingBaseline), originalBaseline);
  const result = await acceptVisualCandidate({ root, candidateId: candidate.candidateId });
  assert.equal(result.accepted.length, 11);
  assert.equal(result.accepted.filter(entry => entry.operation === "add").length, 10);
  assert.equal(result.accepted.filter(entry => entry.operation === "update").length, 1);
  const complete = await assertVisualBaselinesComplete(root);
  assert.equal(complete.baselineCount, 14);
  const manifest = JSON.parse(await readFile(join(root, "visual/test-manifest.json"), "utf8"));
  assert.deepEqual(manifest.baselineAdditions, []);
});

test("visual candidates with changed source inputs are rejected without changing formal PNGs", async t => {
  const root = await makeVisualWorkspace();
  const snapshot = join(dirname(root), `${basename(root)}-fixed-snapshot`);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(snapshot, { recursive: true, force: true });
  });
  const { candidate } = await prepareCandidate(root);
  const baselinePath = join(root, "frontend/e2e/dashboard-visual.spec.ts-snapshots/login-light-visual-linux-linux.png");
  const original = await readFile(baselinePath);
  await writeFile(join(root, "frontend/src/page.ts"), "changed after candidate generation\n");
  await assert.rejects(acceptVisualCandidate({ root, candidateId: candidate.candidateId }), /stale/);
  assert.deepEqual(await readFile(baselinePath), original);
  await assert.rejects(
    readFile(join(root, "frontend/e2e/dashboard-visual.spec.ts-snapshots/users-table-light-visual-linux-linux.png")),
    { code: "ENOENT" }
  );
});

test("visual acceptance rolls back earlier baseline writes when a later target write fails", async t => {
  const root = await makeVisualWorkspace();
  const snapshot = join(dirname(root), `${basename(root)}-fixed-snapshot`);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(snapshot, { recursive: true, force: true });
  });
  const { candidate } = await prepareCandidate(root);
  const loginLight = join(root, "frontend/e2e/dashboard-visual.spec.ts-snapshots/login-light-visual-linux-linux.png");
  const originalLoginLight = await readFile(loginLight);
  const failingTarget = join(root, "frontend/e2e/dashboard-visual.spec.ts-snapshots/dashboard-horizontal-light-visual-linux-linux.png");
  await assert.rejects(acceptVisualCandidate({
    root,
    candidateId: candidate.candidateId,
    operations: {
      atomicWrite: async (target, bytes, mode) => {
        if (target === failingTarget) throw new Error("simulated second-phase write failure");
        await writeFile(target, bytes, { mode });
      }
    }
  }), /rollback was attempted/);
  assert.deepEqual(await readFile(loginLight), originalLoginLight);
  await assert.rejects(readFile(failingTarget), { code: "ENOENT" });
  const manifest = JSON.parse(await readFile(join(root, "visual/test-manifest.json"), "utf8"));
  assert.equal(manifest.baselineAdditions.length, 10);
});
