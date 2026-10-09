import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  copyFixedWorkspace,
  initializeScenarioReport,
  loadArchitectureRules,
  repositoryRoot,
  summarizeInputs,
  summarizeSnapshotInputs,
  summarizeFixedPaths,
  suiteInputSha256,
  verifyReportSet,
  verifyScenarioReport
} from "./test-architecture.mjs";

const requiredFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "frontend/package.json",
  "frontend/playwright.config.ts",
  "frontend/vitest.config.ts",
  "frontend/vitest.components.config.ts",
  "supabase/config.toml",
  "supabase/functions/deno.json",
  "supabase/functions/_shared/contracts/package.json",
  "visual/test-manifest.json",
  "scripts/test-architecture-rules.json",
  "scripts/agent-testing.test.mjs",
  "scripts/test-architecture.test.mjs"
];

test("BrowserSkill record CLI accepts the pnpm argument separator", () => {
  assert.throws(
    () => execFileSync(process.execPath, [
      join(repositoryRoot, "scripts/test-architecture.mjs"),
      "record", "--", "--run-id", "invalid"
    ], { encoding: "utf8" }),
    error => {
      assert.equal(error.status, 1);
      assert.match(error.stderr, /--run-id must be a UUID/);
      assert.doesNotMatch(error.stderr, /Expected a value after --/);
      return true;
    }
  );
});

async function makeWorkspace() {
  const root = await mkdtemp(join(os.tmpdir(), "test-architecture-fixture-"));
  for (const path of requiredFiles) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    if (path === "scripts/test-architecture-rules.json") {
      await writeFile(target, await readFile(join(repositoryRoot, path)));
    } else if (path === "visual/test-manifest.json") {
      await writeFile(target, await readFile(join(repositoryRoot, path)));
    } else {
      await writeFile(target, "fixture\n");
    }
  }
  await mkdir(join(root, "frontend/src"), { recursive: true });
  await mkdir(join(root, "frontend/e2e"), { recursive: true });
  await writeFile(join(root, "frontend/src/page.ts"), "export const page = 'before';\n");
  await writeFile(join(root, "frontend/e2e/messages-smoke.spec.ts"), "test('legacy', () => {});\n");
  await writeFile(join(root, "frontend/e2e/dashboard-visual.spec.ts"), "test('pixels', () => {});\n");
  await writeFile(join(root, "frontend/e2e/visual-route-review.spec.ts"), "test('matrix', () => {});\n");
  const baseline = join(root, "frontend/e2e/dashboard-visual.spec.ts-snapshots/linux/login.png");
  await mkdir(dirname(baseline), { recursive: true });
  await writeFile(baseline, "baseline\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

async function createPassingReport(root, scenario = "messages-shell") {
  const summary = await summarizeInputs(root, "browser");
  const { rules } = await loadArchitectureRules(root);
  const startedAt = "2026-10-07T00:00:00.000Z";
  const finishedAt = "2026-10-07T00:01:00.000Z";
  const appOrigin = "http://127.0.0.1:41000";
  const report = await initializeScenarioReport({
    runId: "test-run",
    scenario,
    inputSummary: summary,
    snapshotSummary: summary,
    browser: { driver: "cli", sessionId: "fixture-session" },
    appOrigin,
    startedAt,
    root
  });
  report.finishedAt = finishedAt;
  report.inputSha256AtEnd = summary.inputSha256;
  report.inputSha256InSnapshotAtEnd = summary.inputSha256;
  report.inputSummaryAtEnd = summary;
  report.snapshotSummaryAtEnd = summary;
  report.productStatus = "Pass";
  report.cleanupStatus = "Succeeded";
  report.evidenceStatus = "Complete";
  report.evidence = [...rules.runRequiredEvidence];
  for (const checkpoint of Object.values(report.checkpoints)) {
    checkpoint.status = "Pass";
    checkpoint.observed = `Observed: ${checkpoint.expected}`;
    checkpoint.evidence = [...rules.checkpointRequiredEvidence];
  }
  const directory = join(root, "frontend/test-results/agent-testing/test-run");
  const evidenceDirectory = join(directory, "evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, "final.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  const captureStart = Date.parse(startedAt) + 5_000;
  const captureEnd = Date.parse(finishedAt) - 5_000;
  await writeFile(join(evidenceDirectory, "browser-debug.json"), JSON.stringify({
    saved_at: captureEnd,
    run: {
      id: "debug-run",
      session_id: "fixture-session",
      url: `${appOrigin}/#/login`,
      started_at: captureStart,
      stopped_at: captureEnd,
      saved_at: captureEnd,
      state: "stopped"
    }
  }));
  const path = join(directory, "report.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return { path, report, summary };
}


test("BrowserSkill digest includes product and unignored untracked inputs", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await summarizeInputs(root, "browser");
  await writeFile(join(root, "frontend/src/new-untracked.ts"), "export const value = 1;\n");
  const after = await summarizeInputs(root, "browser");
  assert.notEqual(before.inputSha256, after.inputSha256);
  assert.notEqual(before.productInputSha256, after.productInputSha256);
  assert.equal(before.managementInputSha256, after.managementInputSha256);
  assert.ok(after.files.some(file => file.path === "frontend/src/new-untracked.ts"));
});

test("source bytes affect input hash while unregistered specs and formal PNG baselines stay outside active inputs", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await summarizeInputs(root, "browser");
  const input = join(root, "frontend/src/page.ts");
  await writeFile(input, "export const page = 'after';\n");
  await writeFile(join(root, "frontend/e2e/messages-smoke.spec.ts"), "test('changed legacy', () => {});\n");
  await writeFile(join(root, "frontend/e2e/dashboard-visual.spec.ts-snapshots/linux/login.png"), "changed baseline\n");
  const after = await summarizeInputs(root, "browser");
  assert.notEqual(before.inputSha256, after.inputSha256);
  assert.ok(!after.files.some(file => file.path === "frontend/e2e/messages-smoke.spec.ts"));
  assert.ok(!after.files.some(file => file.path.endsWith("login.png")));
});


test("BrowserSkill runner and startup inputs invalidate scenario evidence without changing product or visual inputs", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "scripts/agent-testing.mjs"), "export const run = 'before';\n");
  await writeFile(join(root, "scripts/check-migrations.mjs"), "export const runner = 'before';\n");
  const browserBefore = await summarizeInputs(root, "browser");
  const visualBefore = await summarizeInputs(root, "visual");
  await writeFile(join(root, "scripts/agent-testing.mjs"), "export const run = 'after';\n");
  await writeFile(join(root, "scripts/check-migrations.mjs"), "export const runner = 'after';\n");
  const browserAfter = await summarizeInputs(root, "browser");
  const visualAfter = await summarizeInputs(root, "visual");
  assert.notEqual(browserBefore.inputSha256, browserAfter.inputSha256);
  assert.notEqual(browserBefore.scenarioInputSha256, browserAfter.scenarioInputSha256);
  assert.equal(browserBefore.managementInputSha256, browserAfter.managementInputSha256);
  assert.equal(browserBefore.productInputSha256, browserAfter.productInputSha256);
  assert.equal(visualBefore.inputSha256, visualAfter.inputSha256);
});

test("unit suite digest reads complete repository inputs including Vitest configs and Node tests", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const browserSummary = await summarizeInputs(root, "browser");
  assert.equal(browserSummary.files.some(file => file.path === "frontend/vitest.config.ts"), false);
  assert.equal(browserSummary.files.some(file => file.path === "scripts/agent-testing.test.mjs"), false);
  const { rules } = await loadArchitectureRules(root);
  const before = await suiteInputSha256(root, "pnpm test:unit", rules);
  await writeFile(join(root, "frontend/vitest.config.ts"), "export default { include: ['**/*.test.ts'] };\n");
  const afterConfig = await suiteInputSha256(root, "pnpm test:unit", rules);
  assert.notEqual(before, afterConfig);
  await writeFile(join(root, "scripts/agent-testing.test.mjs"), "test('regression', () => assert.equal(1, 1));\n");
  const afterNodeTest = await suiteInputSha256(root, "pnpm test:unit", rules);
  assert.notEqual(afterConfig, afterNodeTest);
  await writeFile(join(root, "scripts/new-gate.test.mjs"), "test('new failing case', () => assert.equal(1, 0));\n");
  const afterNewTest = await suiteInputSha256(root, "pnpm test:unit", rules);
  assert.notEqual(afterNodeTest, afterNewTest);
  const browserBefore = await suiteInputSha256(root, "pnpm test:browser", rules);
  const updatedRules = { ...rules, rulesVersion: `${rules.rulesVersion}-next` };
  await writeFile(join(root, "scripts/test-architecture-rules.json"), `${JSON.stringify(updatedRules, null, 2)}\n`);
  const browserAfter = await suiteInputSha256(root, "pnpm test:browser", updatedRules);
  assert.notEqual(browserBefore, browserAfter);
});

test("input-rule changes alter the rules hash and reject a fixed snapshot", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const summary = await summarizeInputs(root, "browser");
  const path = join(root, "scripts/test-architecture-rules.json");
  const rules = JSON.parse(await readFile(path, "utf8"));
  rules.rulesVersion = `${rules.rulesVersion}.changed`;
  await writeFile(path, `${JSON.stringify(rules, null, 2)}\n`);
  const after = await summarizeInputs(root, "browser");
  assert.notEqual(summary.rulesSha256, after.rulesSha256);
  await assert.rejects(
    summarizeFixedPaths(root, "browser", summary.files.map(file => file.path), summary.rulesSha256),
    /rules changed/
  );
});

test("changing an input exclusion rule invalidates a completed BrowserSkill report", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { path, report } = await createPassingReport(root);
  const rulesPath = join(root, "scripts/test-architecture-rules.json");
  const rules = JSON.parse(await readFile(rulesPath, "utf8"));
  rules.excludedPathPatterns.push("**/new-exclusion/**");
  await writeFile(rulesPath, `${JSON.stringify(rules, null, 2)}\n`);
  const changedSummary = await summarizeInputs(root, "browser");
  const checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: changedSummary, root });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some(error => error.includes("rules version or hash")));
});

test("fixed workspace copy matches both source snapshots and detects a copy mutation", async t => {
  const root = await makeWorkspace();
  const parent = await mkdtemp(join(os.tmpdir(), "fixed-workspace-parent-"));
  const target = join(parent, "snapshot");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  });
  const result = await copyFixedWorkspace(root, target, "browser");
  assert.equal(result.before.inputSha256, result.copy.inputSha256);
  assert.equal(result.before.inputSha256, result.after.inputSha256);
  await writeFile(join(target, "frontend/src/page.ts"), "changed snapshot\n");
  const changed = await summarizeFixedPaths(target, "browser", result.before.files.map(file => file.path), result.before.rulesSha256);
  assert.notEqual(changed.inputSha256, result.before.inputSha256);
});

test("fixed snapshots preserve tracked deletions in their input inventory", async t => {
  const root = await makeWorkspace();
  const parent = await mkdtemp(join(os.tmpdir(), "fixed-deletion-parent-"));
  const target = join(parent, "snapshot");
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  });
  execFileSync("git", ["add", "frontend/src/page.ts"], { cwd: root });
  await rm(join(root, "frontend/src/page.ts"));
  const before = await summarizeInputs(root, "browser");
  assert.equal(before.files.find(file => file.path === "frontend/src/page.ts")?.state, "deleted");

  const copied = await copyFixedWorkspace(root, target, "browser");
  assert.equal(copied.copy.inputSha256, before.inputSha256);
  await writeFile(join(target, "frontend/src/page.ts"), "unexpected reappearance\n");
  const changed = await summarizeSnapshotInputs(target, "browser", before);
  assert.notEqual(changed.inputSha256, before.inputSha256);
});

test("a complete scenario report passes only with every checkpoint, expected evidence and cleanup", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { path } = await createPassingReport(root);
  const result = await verifyReportSet({ reportPaths: [path], scenarios: ["messages-shell"], root });
  assert.equal(result.valid, true, result.errors.join("\n"));
});


test("runner, account, fixture and startup-script drift invalidate BrowserSkill evidence", async () => {
  const executionPaths = [
    "scripts/agent-testing.mjs",
    "scripts/initial-admin-credentials.mjs",
    "scripts/check-migrations.mjs"
  ];
  for (const path of executionPaths) {
    const root = await makeWorkspace();
    const sourcePath = join(root, path);
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "export const executionInput = 'before';\n");
    const { path: reportPath, report } = await createPassingReport(root);
    await writeFile(sourcePath, "export const executionInput = 'after';\n");
    const current = await summarizeInputs(root, "browser");
    const checked = await verifyScenarioReport(report, { reportDirectory: dirname(reportPath), currentSummary: current, root });
    assert.equal(checked.valid, false, `${path} must invalidate the old run evidence`);
    assert.ok(checked.errors.some(error => error.includes(path)));
    await rm(root, { recursive: true, force: true });
  }
});

test("BrowserSkill evidence is bound to the report session, origin and time window", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { path, report, summary } = await createPassingReport(root);
  const evidencePath = join(dirname(path), "evidence/browser-debug.json");
  const originalDebug = JSON.parse(await readFile(evidencePath, "utf8"));
  const originalSession = report.browser.sessionId;
  const originalOrigin = report.appOrigin;

  report.browser.sessionId = "another-session";
  let checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some(error => error.includes("debug session does not match")));
  report.browser.sessionId = originalSession;

  report.appOrigin = "http://127.0.0.1:41001";
  checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some(error => error.includes("app origin does not match")));
  report.appOrigin = originalOrigin;

  const outsideWindow = structuredClone(originalDebug);
  outsideWindow.run.started_at = Date.parse(report.startedAt) - 60_000;
  await writeFile(evidencePath, JSON.stringify(outsideWindow));
  checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some(error => error.includes("capture start falls outside")));

  outsideWindow.run.started_at = originalDebug.run.started_at;
  outsideWindow.run.stopped_at = Date.parse(report.finishedAt) + 60_000;
  outsideWindow.run.saved_at = outsideWindow.run.stopped_at;
  outsideWindow.saved_at = outsideWindow.run.stopped_at;
  await writeFile(evidencePath, JSON.stringify(outsideWindow));
  checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some(error => error.includes("capture end falls outside")));

  outsideWindow.run.stopped_at = originalDebug.run.stopped_at;
  outsideWindow.run.saved_at = originalDebug.run.saved_at;
  outsideWindow.saved_at = Date.parse(report.finishedAt) + 60_000;
  await writeFile(evidencePath, JSON.stringify(outsideWindow));
  checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
  assert.equal(checked.valid, false);
  assert.ok(checked.errors.some(error => error.includes("capture end falls outside")));
});

test("BrowserSkill evidence accepts the runs array only when its single run matches", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { path, report, summary } = await createPassingReport(root);
  const evidencePath = join(dirname(path), "evidence/browser-debug.json");
  const debug = JSON.parse(await readFile(evidencePath, "utf8"));
  const run = debug.run;
  delete debug.run;
  debug.runs = [run];
  await writeFile(evidencePath, JSON.stringify(debug));
  const checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
  assert.equal(checked.valid, true, checked.errors.join("\n"));
});

test("missing, skipped and Unknown checkpoints all fail verification", async () => {
  for (const mutation of [
    report => { delete report.checkpoints[Object.keys(report.checkpoints)[0]]; },
    report => { report.checkpoints[Object.keys(report.checkpoints)[0]].status = "Skipped"; },
    report => { report.checkpoints[Object.keys(report.checkpoints)[0]].status = "Unknown"; }
  ]) {
    const root = await makeWorkspace();
    const { path, report, summary } = await createPassingReport(root);
    mutation(report);
    const checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
    assert.equal(checked.valid, false);
    await rm(root, { recursive: true, force: true });
  }
});

test("missing evidence, failed cleanup and changed source inputs fail verification", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { path, report, summary } = await createPassingReport(root);
  const directory = dirname(path);
  const evidencePath = join(directory, "evidence/browser-debug.json");

  await rm(evidencePath);
  let result = await verifyScenarioReport(report, { reportDirectory: directory, currentSummary: summary, root });
  assert.equal(result.valid, false);
  await writeFile(evidencePath, JSON.stringify({ run: { id: "debug-run" } }));

  report.cleanupStatus = "Failed";
  result = await verifyScenarioReport(report, { reportDirectory: directory, currentSummary: summary, root });
  assert.equal(result.valid, false);
  report.cleanupStatus = "Succeeded";

  await writeFile(join(root, "frontend/src/page.ts"), "worktree changed\n");
  const current = await summarizeInputs(root, "browser");
  result = await verifyScenarioReport(report, { reportDirectory: directory, currentSummary: current, root });
  assert.equal(result.valid, false);
});

test("a copy mutation or missing end-of-run copy summary fails verification", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { path, report, summary } = await createPassingReport(root);
  report.inputSha256InSnapshotAtEnd = "0".repeat(64);
  const copiedMismatch = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
  assert.equal(copiedMismatch.valid, false);
  report.inputSha256InSnapshotAtEnd = summary.inputSha256;
  report.snapshotSummaryAtEnd = null;
  const missingCopyEnd = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: summary, root });
  assert.equal(missingCopyEnd.valid, false);
});

test("restoring the exact worktree inputs restores digest validity", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { path, report, summary } = await createPassingReport(root);
  const source = join(root, "frontend/src/page.ts");
  const original = await readFile(source);
  await writeFile(source, "temporary edit\n");
  assert.notEqual((await summarizeInputs(root, "browser")).inputSha256, summary.inputSha256);
  await writeFile(source, original);
  const restored = await summarizeInputs(root, "browser");
  const checked = await verifyScenarioReport(report, { reportDirectory: dirname(path), currentSummary: restored, root });
  assert.equal(checked.valid, true, checked.errors.join("\n"));
});

test("a full report collection fails when any of the eight current scenarios is absent", async t => {
  const root = await makeWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const { path } = await createPassingReport(root, "dashboard");
  const result = await verifyReportSet({ reportPaths: [path], root });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("no report supplied for scenario profile")));
});
