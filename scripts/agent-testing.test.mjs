import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isDebugCaptureActive, mergeBrowserPageVisited, mergeProductStatus } from "./agent-testing-helpers.mjs";
import {
  browserExecutionInputsMatch,
  cleanupOwnedResources,
  createStartupLifecycle,
  ownerMarkersMatch,
  runCancellableStartupChecks,
  startOwnedStack,
  startupStage,
  listTemporaryDockerResources,
  stopAndVerifyTemporaryStack,
  temporarySupabaseProjectId,
  StartupCancelledError,
  supervisorCleanupMode,
  terminateVerifiedProcess,
  viteListenerOwnerMarkers,
  viteProcessOwnerMarkers
} from "./agent-testing-lifecycle.mjs";
import { initialAdmin, initialAdminPassword } from "./initial-admin-credentials.mjs";
import { hasBrowserDebugCapture, updateEvidenceState } from "./agent-testing-evidence.mjs";
import { playwrightArtifactDirectories, playwrightArtifactEnvironment } from "./playwright-artifacts.mjs";
import { bestEffortBrowserCleanup, projectRoot } from "./agent-testing.mjs";

test("an observed product failure remains a failure after interruption", () => {
  assert.equal(mergeProductStatus("Fail", "Unknown"), "Fail");
  assert.equal(mergeProductStatus("Fail", "Pass"), "Fail");
  assert.equal(mergeProductStatus("Pass", "Fail"), "Fail");
});

test("a run without an observed outcome stays Unknown until explicitly classified", () => {
  assert.equal(mergeProductStatus(undefined, undefined), "Unknown");
  assert.equal(mergeProductStatus(undefined, "Pass"), "Pass");
  assert.equal(mergeProductStatus("Unknown", "Pass"), "Pass");
  assert.equal(mergeProductStatus("Pass", undefined), "Pass");
});

test("active BrowserSkill captures include the actual capturing state", () => {
  assert.equal(isDebugCaptureActive({ run: { state: "capturing" } }), true);
  assert.equal(isDebugCaptureActive({ state: "recording" }), true);
  assert.equal(isDebugCaptureActive({ capture: { state: "capturing" } }), true);
  assert.equal(isDebugCaptureActive({ runs: [{ state: "capturing" }] }), true);
  assert.equal(isDebugCaptureActive({ run: { state: "stopped" } }), false);
  assert.equal(isDebugCaptureActive({}), false);
});

test("cleanup requests to preserve page evidence reach the supervisor", () => {
  assert.equal(mergeBrowserPageVisited(undefined, true), true);
  assert.equal(mergeBrowserPageVisited(false, true), true);
  assert.equal(mergeBrowserPageVisited(true, false), true);
  assert.equal(mergeBrowserPageVisited(false, undefined), false);
});

test("startup cancellation waits for the in-flight stage and prevents later stages", async () => {
  let releaseStage;
  let cleanupCount = 0;
  let laterStageStarted = false;
  const pendingStage = new Promise(resolve => { releaseStage = resolve; });
  const lifecycle = createStartupLifecycle(async () => { cleanupCount += 1; });

  const startup = (async () => {
    try {
      await startupStage(lifecycle, () => pendingStage);
      laterStageStarted = true;
    } catch (error) {
      if (!(error instanceof StartupCancelledError)) throw error;
      cleanupCount += 1;
    }
  })();

  lifecycle.requestShutdown("SIGTERM");
  assert.equal(cleanupCount, 0);
  releaseStage();
  await startup;

  assert.equal(laterStageStarted, false);
  assert.equal(cleanupCount, 1);
});

test("a failed startup readiness check aborts and waits for its sibling", async () => {
  let siblingSettled = false;
  await assert.rejects(runCancellableStartupChecks([
    async () => { throw new Error("Vite exited during readiness"); },
    signal => new Promise(resolve => {
      signal.addEventListener("abort", () => {
        siblingSettled = true;
        resolve();
      }, { once: true });
    })
  ]), /Vite exited/);
  assert.equal(siblingSettled, true);
});

test("shutdown requested after readiness invokes cleanup once", async () => {
  let cleanupCount = 0;
  const lifecycle = createStartupLifecycle(async () => { cleanupCount += 1; });
  lifecycle.markReady();
  await lifecycle.requestShutdown("SIGTERM");
  await lifecycle.requestShutdown("SIGINT");
  assert.equal(cleanupCount, 1);
});

test("a terminated or reused supervisor selects orphan cleanup, never its PID", () => {
  const expected = "Tue Oct 7 19:00:00 2026 node scripts/agent-testing.mjs start";
  assert.equal(supervisorCleanupMode(expected, null, null), "orphan");
  assert.equal(supervisorCleanupMode(expected, "Tue Oct 7 19:00:01 2026 node unrelated.js", null), "orphan");
  assert.equal(supervisorCleanupMode(expected, expected, null), "signal");
  assert.equal(supervisorCleanupMode(expected, expected, "2026-10-07T19:00:01Z"), "wait");
});

test("Vite parent and listener use markers matching their actual recorded commands", () => {
  const port = 49597;
  const frontendRoot = "/Users/kanehua/project/fullstack-admin-template/frontend";
  const parentIdentity = "Wed Oct 7 19:50:49 2026 pnpm --filter fullstack-admin-frontend exec vite --host 127.0.0.1 --port 49597 --strictPort";
  const listenerIdentity = "Wed Oct 7 19:50:49 2026 node /Users/kanehua/project/fullstack-admin-template/frontend/node_modules/.bin/../vite/bin/vite.js --host 127.0.0.1 --port 49597 --strictPort";
  const parentMarkers = viteProcessOwnerMarkers(port);
  const listenerMarkers = viteListenerOwnerMarkers(port, frontendRoot);

  assert.equal(ownerMarkersMatch(parentIdentity, parentMarkers), true);
  assert.equal(ownerMarkersMatch(parentIdentity, listenerMarkers), false);
  assert.equal(ownerMarkersMatch(listenerIdentity, listenerMarkers), true);
  assert.equal(ownerMarkersMatch(listenerIdentity, parentMarkers), false);
});

test("a failed partial Supabase start remains registered for cleanup", async () => {
  const record = { stackMayExist: false, projectRoot: "/tmp/agent/project", tempRoot: "/tmp/agent" };
  let persistedMayExist = false;
  let stopAttempts = 0;
  let removeAttempts = 0;

  await assert.rejects(
    startOwnedStack(record, async () => { persistedMayExist = record.stackMayExist; }, async () => {
      throw new Error("supabase start timed out after creating containers");
    }),
    /timed out/
  );
  assert.equal(persistedMayExist, true);

  const result = await cleanupOwnedResources(record, {
    cleanupBrowser: async () => [],
    stopProcesses: async () => [],
    stopStack: async () => { stopAttempts += 1; return true; },
    removeProject: async () => { removeAttempts += 1; },
    removeCredentials: async () => true
  });
  assert.equal(stopAttempts, 1);
  assert.equal(removeAttempts, 1);
  assert.equal(result.cleanupStatus, "Succeeded");
  assert.equal(record.stackMayExist, false);
});

test("orphan cleanup stops BrowserSkill and owned services before reporting success", async () => {
  const calls = [];
  const record = {
    browser: { sessionId: "browser-session" },
    children: { vite: { pid: 101 }, edge: { pid: 102 } },
    stackMayExist: true,
    projectRoot: "/tmp/agent/project",
    tempRoot: "/tmp/agent"
  };

  const result = await cleanupOwnedResources(record, {
    cleanupBrowser: async () => { calls.push("browser"); return []; },
    stopProcesses: async () => { calls.push("processes"); return []; },
    stopStack: async () => { calls.push("supabase"); return true; },
    removeProject: async () => { calls.push("project-directory"); },
    removeCredentials: async () => { calls.push("credentials"); }
  });

  assert.deepEqual(calls, ["browser", "processes", "supabase", "project-directory", "credentials"]);
  assert.equal(result.cleanupStatus, "Succeeded");
});

test("failed Supabase stop preserves the workspace and still removes credentials", async () => {
  const calls = [];
  const record = {
    stackMayExist: true,
    projectRoot: "/tmp/agent/project",
    tempRoot: "/tmp/agent"
  };
  const result = await cleanupOwnedResources(record, {
    cleanupBrowser: async () => [],
    stopProcesses: async () => [],
    stopStack: async () => { calls.push("stop"); throw new Error("Docker refused shutdown"); },
    removeProject: async () => { calls.push("remove-project"); },
    removeCredentials: async () => { calls.push("remove-credentials"); }
  });

  assert.deepEqual(calls, ["stop", "remove-credentials"]);
  assert.equal(record.retainedProjectRoot, "/tmp/agent/project");
  assert.equal(result.cleanupStatus, "Failed");
  assert.match(result.cleanupFailures.join(" "), /workspace retained for recovery/);
});

test("a successful Supabase CLI exit is not enough when tagged Docker resources remain", async () => {
  const calls = [];
  await assert.rejects(
    stopAndVerifyTemporaryStack("agent-cleanup-fixture", async projectId => {
      calls.push(`stop:${projectId}`);
    }, async (kind, projectId) => {
      calls.push(`inspect:${kind}:${projectId}`);
      return kind === "volumes" ? ["supabase_db_agent-cleanup-fixture"] : [];
    }),
    /still owns Docker resources \(volumes: supabase_db_agent-cleanup-fixture\)/
  );
  assert.deepEqual(calls, [
    "stop:agent-cleanup-fixture",
    "inspect:containers:agent-cleanup-fixture",
    "inspect:volumes:agent-cleanup-fixture",
    "inspect:networks:agent-cleanup-fixture"
  ]);
});

test("identity-navigation temporary project IDs keep their random suffix within the Supabase 40-character limit", () => {
  const projectId = temporarySupabaseProjectId("identity-navigation", "0123456789abcdef");
  assert.equal(projectId, "agent-identity-navigati-0123456789abcdef");
  assert.equal(projectId.length, 40);
});

test("cleanup rejects an ID that Supabase would truncate before inspecting Docker labels", async () => {
  const overlongId = "agent-identity-navigation-0123456789abcdef";
  assert.equal(overlongId.length, 42);
  let stopCalled = false;
  let inspectCalled = false;
  await assert.rejects(
    stopAndVerifyTemporaryStack(overlongId, async () => { stopCalled = true; }, async () => {
      inspectCalled = true;
      return [];
    }),
    /no longer than 40 characters/
  );
  assert.equal(stopCalled, false);
  assert.equal(inspectCalled, false);
});

test("BrowserSkill execution inputs stay strict while report and ledger digests may drift", () => {
  const baseline = {
    purpose: "browser",
    rulesVersion: "2026-10-08.1",
    rulesSha256: "a".repeat(64),
    productInputSha256: "b".repeat(64),
    scenarioInputSha256: "c".repeat(64),
    managementInputSha256: "d".repeat(64),
    ledgerInputSha256: "e".repeat(64)
  };
  assert.equal(browserExecutionInputsMatch(baseline, {
    ...baseline,
    managementInputSha256: "f".repeat(64),
    ledgerInputSha256: "0".repeat(64)
  }), true);
  assert.equal(browserExecutionInputsMatch(baseline, { ...baseline, scenarioInputSha256: "0".repeat(64) }), false);
  assert.equal(browserExecutionInputsMatch(baseline, { ...baseline, productInputSha256: "0".repeat(64) }), false);
  assert.equal(browserExecutionInputsMatch(baseline, { ...baseline, rulesSha256: "0".repeat(64) }), false);
});

test("migration stack cleanup accepts owned non-agent project IDs and checks every resource class", async () => {
  const calls = [];
  await assert.rejects(
    stopAndVerifyTemporaryStack("upg-base-6a5f1234", async projectId => {
      calls.push(`stop:${projectId}`);
    }, async (kind, projectId) => {
      calls.push(`inspect:${kind}:${projectId}`);
      return kind === "networks" ? ["supabase_network_upg-base-6a5f1234"] : [];
    }),
    /still owns Docker resources \(networks: supabase_network_upg-base-6a5f1234\)/
  );
  assert.deepEqual(calls, [
    "stop:upg-base-6a5f1234",
    "inspect:containers:upg-base-6a5f1234",
    "inspect:volumes:upg-base-6a5f1234",
    "inspect:networks:upg-base-6a5f1234"
  ]);
  assert.throws(() => listTemporaryDockerResources("services", "upg-base-6a5f1234"), /Unknown temporary Docker resource kind/);
});

test("a stale project label makes cleanup fail and preserves its recovery workspace", async () => {
  let removeProject = false;
  const record = {
    stackMayExist: true,
    projectRoot: "/tmp/agent/project",
    tempRoot: "/tmp/agent"
  };
  const result = await cleanupOwnedResources(record, {
    cleanupBrowser: async () => [],
    stopProcesses: async () => [],
    stopStack: () => stopAndVerifyTemporaryStack("agent-cleanup-fixture", async () => undefined, async kind =>
      kind === "containers" ? ["supabase_db_agent-cleanup-fixture"] : []),
    removeProject: async () => { removeProject = true; },
    removeCredentials: async () => undefined
  });

  assert.equal(result.cleanupStatus, "Failed");
  assert.equal(result.stackStopped, false);
  assert.equal(removeProject, false);
  assert.equal(record.retainedProjectRoot, "/tmp/agent/project");
  assert.match(result.cleanupFailures.join(" "), /still owns Docker resources/);
});

test("a later cleanup retry can remove a preserved workspace and keeps failure history", async () => {
  const calls = [];
  const record = {
    stackMayExist: true,
    projectRoot: "/tmp/agent/project",
    tempRoot: "/tmp/agent"
  };
  await cleanupOwnedResources(record, {
    cleanupBrowser: async () => [],
    stopProcesses: async () => [],
    stopStack: async () => { throw new Error("first stop failed"); },
    removeProject: async () => { calls.push("remove-project"); },
    removeCredentials: async () => undefined
  });
  assert.equal(record.cleanupStatus, "Failed");
  assert.equal(calls.includes("remove-project"), false);

  const result = await cleanupOwnedResources(record, {
    cleanupBrowser: async () => [],
    stopProcesses: async () => [],
    stopStack: async () => true,
    removeProject: async () => { calls.push("remove-project"); },
    removeCredentials: async () => undefined
  });

  assert.equal(result.cleanupStatus, "Succeeded");
  assert.deepEqual(calls, ["remove-project"]);
  assert.equal(record.retainedProjectRoot, null);
  assert.equal(record.cleanupHistory.length, 1);
});

test("a failed owned-process stop does not become a successful cleanup", async () => {
  const result = await cleanupOwnedResources({ cleanupFailures: [] }, {
    cleanupBrowser: async () => [],
    stopProcesses: async () => ["Vite process remained alive"],
    stopStack: async () => true,
    removeProject: async () => undefined,
    removeCredentials: async () => undefined
  });
  assert.equal(result.cleanupStatus, "Failed");
  assert.match(result.cleanupFailures.join(" "), /Vite process remained alive/);
});

test("missing debug evidence keeps acceptance Unknown after resource cleanup is retried", async () => {
  const record = {
    productStatus: "Pass",
    browserPageVisited: true,
    requiredEvidence: ["evidence/final.png", "evidence/browser-debug.json"],
    evidenceStatus: "Incomplete",
    evidenceFailures: ["BrowserSkill debug export failed"]
  };
  const cleanup = await cleanupOwnedResources(record, {
    cleanupBrowser: async () => updateEvidenceState(record, ["evidence/final.png"]),
    stopProcesses: async () => [],
    stopStack: async () => true,
    removeProject: async () => undefined,
    removeCredentials: async () => undefined
  });
  assert.equal(cleanup.cleanupStatus, "Succeeded");
  assert.equal(record.evidenceStatus, "Incomplete");
  assert.equal(record.productStatus, "Unknown");
  assert.ok(record.evidenceFailures.some(failure => failure.includes("browser-debug.json")));
});

test("a failed debug export remains required after BrowserSkill session stop", async () => {
  let sessionPresent = true;
  let persistedDebugRequirement = false;
  let debugStopped = false;
  const cleanupFailures = [];
  const record = {
    runId: "evidence-run",
    stateRoot: "/tmp/evidence-run",
    browser: { sessionId: "evidence-session", instanceId: "fb5e899d" },
    browserPageVisited: true,
    productStatus: "Pass",
    evidence: [],
    requiredEvidence: [],
    evidenceStatus: "Pending",
    evidenceFailures: []
  };
  const operations = {
    mkdir: async () => undefined,
    atomicJson: async (_path, value) => {
      if (value.requiredEvidence.includes("evidence/browser-debug.json")) persistedDebugRequirement = true;
    },
    stat: async path => {
      if (path.endsWith("final.png")) return { isFile: () => true, size: 64 };
      const error = new Error("missing debug export");
      error.code = "ENOENT";
      throw error;
    },
    readFile: async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    runSync: (_command, args) => {
      if (args[0] === "session" && args[1] === "list") {
        return JSON.stringify(sessionPresent ? [{ session_id: "evidence-session", browser_instance_id: "fb5e899d" }] : []);
      }
      if (args[0] === "debug" && args[1] === "status") {
        return JSON.stringify({ runs: [{ id: "capture-1", state: debugStopped ? "stopped" : "capturing" }] });
      }
      if (args[0] === "debug" && args[1] === "stop") {
        assert.equal(persistedDebugRequirement, true);
        debugStopped = true;
        return "{}";
      }
      if (args[0] === "debug" && args[1] === "export") throw new Error("simulated export failure");
      if (args[0] === "screenshot") return "{}";
      throw new Error(`Unexpected BrowserSkill command: ${args.join(" ")}`);
    },
    stopBrowserSession: async () => { sessionPresent = false; }
  };

  await bestEffortBrowserCleanup(record, cleanupFailures, operations);
  assert.equal(sessionPresent, false);
  assert.equal(record.evidenceStatus, "Incomplete");
  assert.equal(record.productStatus, "Unknown");
  assert.equal(cleanupFailures.length, 0);
  assert.ok(record.requiredEvidence.includes("evidence/browser-debug.json"));

  await bestEffortBrowserCleanup(record, cleanupFailures, operations);
  assert.equal(record.evidenceStatus, "Incomplete");
  assert.equal(record.productStatus, "Unknown");
  assert.ok(record.evidenceFailures.some(failure => failure.includes("browser-debug.json")));
});

test("Harness-managed cleanup imports evidence and never calls the bsk CLI", async t => {
  const runId = randomUUID();
  const source = await mkdtemp(join(os.tmpdir(), "browser-harness-evidence-"));
  const report = join(projectRoot, "frontend/test-results/agent-testing", runId);
  const evidence = join(report, "evidence");
  t.after(async () => {
    await rm(source, { recursive: true, force: true });
    await rm(report, { recursive: true, force: true });
  });
  await writeFile(join(source, "final.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  await writeFile(join(source, "browser-debug.json"), JSON.stringify({ run: { id: "harness-capture" } }));
  const record = {
    runId,
    browser: { driver: "harness", instanceId: "fb5e899d", sessionId: "harness-session" },
    browserSessionStopped: true,
    externalEvidenceSource: source,
    browserPageVisited: true,
    productStatus: "Pass",
    requiredEvidence: ["evidence/final.png", "evidence/browser-debug.json"],
    evidence: [],
    evidenceFailures: []
  };
  const failures = [];

  await bestEffortBrowserCleanup(record, failures, {
    runSync: () => { throw new Error("Harness cleanup must not invoke bsk CLI commands"); }
  });

  assert.deepEqual(failures, []);
  assert.equal(record.evidenceStatus, "Complete");
  assert.equal(record.productStatus, "Pass");
  assert.deepEqual(record.evidence.sort(), ["evidence/browser-debug.json", "evidence/final.png"]);
  assert.deepEqual((await readdir(evidence)).sort(), ["browser-debug.json", "final.png"]);
});

test("Harness cleanup remains Unknown until the external Session stop is confirmed", async t => {
  const runId = randomUUID();
  const source = await mkdtemp(join(os.tmpdir(), "browser-harness-evidence-"));
  const report = join(projectRoot, "frontend/test-results/agent-testing", runId);
  t.after(async () => {
    await rm(source, { recursive: true, force: true });
    await rm(report, { recursive: true, force: true });
  });
  await writeFile(join(source, "final.png"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]));
  await writeFile(join(source, "browser-debug.json"), JSON.stringify({ run: { id: "harness-capture" } }));
  const record = {
    runId,
    browser: { driver: "harness", instanceId: "fb5e899d", sessionId: "harness-session" },
    browserSessionStopped: false,
    externalEvidenceSource: source,
    browserPageVisited: true,
    productStatus: "Pass",
    requiredEvidence: ["evidence/final.png", "evidence/browser-debug.json"],
    evidence: [],
    evidenceFailures: []
  };
  const failures = [];

  await bestEffortBrowserCleanup(record, failures, {
    runSync: () => { throw new Error("Harness cleanup must not invoke bsk CLI commands"); }
  });

  assert.equal(record.evidenceStatus, "Unknown");
  assert.equal(record.productStatus, "Unknown");
  assert.ok(failures.some(failure => failure.includes("Session stop was not confirmed")));
});

test("stopped debug runs still require an export artifact", () => {
  assert.equal(hasBrowserDebugCapture({ runs: [{ id: "capture-1", state: "stopped" }] }), true);
  assert.equal(hasBrowserDebugCapture({ runs: [] }), false);
});

test("a recorded process that ignores SIGTERM is killed and verified", async () => {
  let identity = "node owned edge server";
  const signals = [];
  const stopped = await terminateVerifiedProcess({
    pid: 123,
    label: "Edge Functions",
    expectedIdentity: identity,
    ownerMarkers: ["owned edge"]
  }, {
    identityFor: async () => identity,
    signal: async (_pid, signal) => {
      signals.push(signal);
      if (signal === "SIGKILL") identity = null;
    },
    waitForExit: async () => identity === null
  });

  assert.equal(stopped, true);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("a process still alive after SIGKILL makes cleanup fail", async () => {
  const identity = "node owned vite server";
  await assert.rejects(
    terminateVerifiedProcess({
      pid: 124,
      label: "Vite listener",
      expectedIdentity: identity,
      ownerMarkers: ["owned vite"]
    }, {
      identityFor: async () => identity,
      signal: async () => undefined,
      waitForExit: async () => false
    }),
    /did not exit after SIGKILL/
  );
});

test("PID reuse is detected before signaling an unrelated process", async () => {
  const signals = [];
  await assert.rejects(
    terminateVerifiedProcess({
      pid: 125,
      label: "Edge Functions",
      expectedIdentity: "old owned process",
      ownerMarkers: ["owned edge"]
    }, {
      identityFor: async () => "new unrelated process",
      signal: async (_pid, signal) => { signals.push(signal); },
      waitForExit: async () => true
    }),
    /identity changed/
  );
  assert.deepEqual(signals, []);
});

test("Playwright output sets remain isolated by suite", () => {
  const browser = playwrightArtifactDirectories("browser");
  const auth = playwrightArtifactDirectories("browser-local");
  const visual = playwrightArtifactDirectories("visual");
  assert.equal(new Set([browser.outputDir, auth.outputDir, visual.outputDir]).size, 3);
  assert.equal(new Set([browser.htmlReport, auth.htmlReport, visual.htmlReport]).size, 3);
  assert.equal(playwrightArtifactEnvironment({ E2E_LOCAL_AUTH: "1" }, "browser-local").PLAYWRIGHT_ARTIFACT_SET, "browser-local");
  assert.throws(() => playwrightArtifactDirectories("../browser"), /Invalid Playwright artifact set/);
});

test("the isolated pilot uses the documented template bootstrap identity", () => {
  assert.equal(initialAdmin.loginName, "admin");
  assert.equal(initialAdmin.email, "admin@example.test");
  assert.equal(initialAdminPassword, "admin123456");
});
