import { spawnSync } from "node:child_process";

export const MAX_TEMPORARY_SUPABASE_PROJECT_ID_LENGTH = 40;

export class StartupCancelledError extends Error {
  constructor(reason) {
    super(`Dashboard startup cancelled: ${reason}`);
    this.name = "StartupCancelledError";
    this.reason = reason;
  }
}

export function browserExecutionInputsMatch(reference, ...summaries) {
  const fields = ["purpose", "rulesVersion", "rulesSha256", "productInputSha256", "scenarioInputSha256"];
  if (!reference || fields.some(field => typeof reference[field] !== "string" || !reference[field])) return false;
  return summaries.every(summary => summary && fields.every(field => summary[field] === reference[field]));
}

export function createStartupLifecycle(onReadyShutdown) {
  let requestedReason;
  let ready = false;
  let shutdownPromise;

  function startShutdown() {
    if (!ready || !requestedReason || shutdownPromise) return shutdownPromise;
    shutdownPromise = Promise.resolve().then(() => onReadyShutdown(requestedReason));
    return shutdownPromise;
  }

  return {
    get cancelled() {
      return requestedReason !== undefined;
    },
    get reason() {
      return requestedReason;
    },
    requestShutdown(reason) {
      requestedReason ??= reason || "shutdown requested";
      return startShutdown();
    },
    throwIfCancelled() {
      if (requestedReason !== undefined) throw new StartupCancelledError(requestedReason);
    },
    markReady() {
      if (requestedReason !== undefined) throw new StartupCancelledError(requestedReason);
      ready = true;
      return startShutdown();
    }
  };
}

export async function startupCheckpoint(lifecycle) {
  await new Promise(resolve => setImmediate(resolve));
  lifecycle.throwIfCancelled();
}

export async function startupStage(lifecycle, operation) {
  lifecycle.throwIfCancelled();
  let result;
  try {
    result = await operation();
  } catch (error) {
    await new Promise(resolve => setImmediate(resolve));
    lifecycle.throwIfCancelled();
    throw error;
  }
  await startupCheckpoint(lifecycle);
  return result;
}

export function supervisorCleanupMode(expectedIdentity, currentIdentity, finishedAt) {
  if (!currentIdentity || !expectedIdentity || currentIdentity !== expectedIdentity) return "orphan";
  return finishedAt ? "wait" : "signal";
}

export function ownerMarkersMatch(identity, ownerMarkers) {
  if (typeof identity !== "string") return false;
  return ownerMarkers.every(marker => typeof marker === "string" && marker.length > 0 && identity.includes(marker));
}

export function viteProcessOwnerMarkers(port) {
  return ["--filter fullstack-admin-frontend", "exec vite", `--port ${port}`];
}

export function viteListenerOwnerMarkers(port, frontendRoot) {
  return [`--port ${port}`, frontendRoot];
}

export async function runCancellableStartupChecks(checks) {
  const controller = new AbortController();
  const tasks = checks.map(check => Promise.resolve().then(() => check(controller.signal)));
  try {
    return await Promise.all(tasks);
  } catch (error) {
    controller.abort();
    await Promise.allSettled(tasks);
    throw error;
  }
}

export async function startOwnedStack(record, persist, start, checkpoint = () => undefined) {
  record.stackMayExist = true;
  await persist();
  try {
    await checkpoint();
  } catch (error) {
    record.stackMayExist = false;
    await persist();
    throw error;
  }
  return await start();
}

export function temporarySupabaseProjectId(scenario, suffix) {
  if (typeof scenario !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scenario)) {
    throw new Error("Temporary Supabase scenario must be a lowercase slug");
  }
  if (typeof suffix !== "string" || !/^[0-9a-f]{16}$/.test(suffix)) {
    throw new Error("Temporary Supabase project ID requires a 64-bit hexadecimal suffix");
  }
  const scenarioLength = MAX_TEMPORARY_SUPABASE_PROJECT_ID_LENGTH - "agent-".length - 1 - suffix.length;
  const scenarioPart = scenario.slice(0, scenarioLength).replace(/-+$/, "");
  if (!scenarioPart) throw new Error("Temporary Supabase scenario name is too long");
  const projectId = `agent-${scenarioPart}-${suffix}`;
  if (projectId.length > MAX_TEMPORARY_SUPABASE_PROJECT_ID_LENGTH) {
    throw new Error(`Temporary Supabase project ID exceeds the ${MAX_TEMPORARY_SUPABASE_PROJECT_ID_LENGTH}-character CLI limit`);
  }
  return projectId;
}

export function listTemporaryDockerResources(kind, projectId) {
  const label = `label=com.docker.compose.project=${projectId}`;
  const commands = {
    containers: ["ps", "-a", "--filter", label, "--format", "{{.Names}}"],
    volumes: ["volume", "ls", "--filter", label, "--format", "{{.Name}}"],
    networks: ["network", "ls", "--filter", label, "--format", "{{.Name}}"]
  };
  const args = commands[kind];
  if (!args) throw new Error(`Unknown temporary Docker resource kind: ${kind}`);
  const result = spawnSync(process.platform === "win32" ? "docker.exe" : "docker", args, {
    encoding: "utf8",
    timeout: 20_000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Docker ${kind} inspection failed (${result.error?.message ?? `exit code ${result.status ?? 1}`}): ${(result.stderr ?? "").trim()}`);
  }
  return (result.stdout ?? "").split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

export async function stopAndVerifyTemporaryStack(projectId, stop, listResources = listTemporaryDockerResources) {
  if (typeof projectId !== "string" || projectId.length > MAX_TEMPORARY_SUPABASE_PROJECT_ID_LENGTH ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId)) {
    throw new Error(`Temporary Supabase project ID must be a valid slug no longer than ${MAX_TEMPORARY_SUPABASE_PROJECT_ID_LENGTH} characters`);
  }
  if (typeof stop !== "function" || typeof listResources !== "function") {
    throw new Error("Temporary Supabase stop verification requires stop and resource-list operations");
  }

  await stop(projectId);
  const kinds = ["containers", "volumes", "networks"];
  const resources = await Promise.all(kinds.map(async kind => {
    const items = await listResources(kind, projectId);
    if (!Array.isArray(items) || items.some(item => typeof item !== "string" || !item.trim())) {
      throw new Error(`Docker ${kind} inspection did not return a valid resource list`);
    }
    return { kind, items };
  }));
  const remaining = resources.filter(resource => resource.items.length > 0);
  if (remaining.length) {
    const detail = remaining.map(resource => `${resource.kind}: ${resource.items.join(", ")}`).join("; ");
    throw new Error(`Supabase CLI returned, but project ${projectId} still owns Docker resources (${detail})`);
  }
  return true;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runCleanupStep(label, operation, failures) {
  try {
    const result = await operation();
    if (result === false) {
      failures.push(`${label}: completion was not confirmed`);
      return false;
    }
    if (Array.isArray(result)) {
      failures.push(...result.map(failure => `${label}: ${failure}`));
      return result.length === 0;
    }
    return true;
  } catch (error) {
    failures.push(`${label}: ${errorMessage(error)}`);
    return false;
  }
}

export async function cleanupOwnedResources(record, operations) {
  const previousFailures = [...(record.cleanupFailures ?? [])];
  if (record.cleanupStatus === "Failed" || previousFailures.length > 0) {
    record.cleanupHistory = [
      ...(record.cleanupHistory ?? []),
      {
        attemptedAt: new Date().toISOString(),
        cleanupFailures: previousFailures,
        retainedProjectRoot: record.retainedProjectRoot ?? null
      }
    ];
  }
  const failures = [];
  await runCleanupStep("BrowserSkill cleanup", () => operations.cleanupBrowser(record), failures);
  await runCleanupStep("Owned process cleanup", () => operations.stopProcesses(record), failures);

  const stackMayExist = record.stackMayExist === true || record.stackStarted === true;
  let stackStopped = !stackMayExist;
  if (stackMayExist) {
    stackStopped = await runCleanupStep("Temporary Supabase stop", () => operations.stopStack(record), failures);
    if (stackStopped) {
      record.stackMayExist = false;
      record.stackStarted = false;
    }
  }

  if (stackStopped) {
    const removed = await runCleanupStep("Temporary project directory removal", () => operations.removeProject(record), failures);
    record.retainedProjectRoot = removed ? null : record.projectRoot ?? record.tempRoot ?? null;
    if (!removed) failures.push(`Temporary project directory retained for recovery at ${record.retainedProjectRoot ?? "<unknown path>"}`);
  } else {
    record.retainedProjectRoot = record.projectRoot ?? record.tempRoot ?? null;
    failures.push(`Temporary Supabase workspace retained for recovery at ${record.retainedProjectRoot ?? "<unknown path>"}`);
  }

  await runCleanupStep("Temporary credential removal", () => operations.removeCredentials(record), failures);
  record.cleanupFailures = [...new Set(failures)];
  record.cleanupStatus = record.cleanupFailures.length ? "Failed" : "Succeeded";
  return { cleanupStatus: record.cleanupStatus, cleanupFailures: record.cleanupFailures, stackStopped };
}

export async function terminateVerifiedProcess({ pid, label, expectedIdentity, ownerMarkers = [] }, operations) {
  const current = await operations.identityFor(pid);
  if (!current) return true;
  if (expectedIdentity && current !== expectedIdentity) {
    throw new Error(`${label} PID identity changed; it was left running`);
  }
  if (!ownerMarkersMatch(current, ownerMarkers)) {
    throw new Error(`${label} PID command did not match this run; it was left running`);
  }

  try {
    await operations.signal(pid, "SIGTERM");
  } catch (error) {
    if (await operations.identityFor(pid) !== current) return true;
    throw error;
  }
  if (await operations.waitForExit(pid, current, 5_000)) return true;

  if (await operations.identityFor(pid) !== current) return true;
  try {
    await operations.signal(pid, "SIGKILL");
  } catch (error) {
    if (await operations.identityFor(pid) !== current) return true;
    throw error;
  }
  if (await operations.waitForExit(pid, current, 2_000)) return true;
  if (await operations.identityFor(pid) !== current) return true;
  throw new Error(`${label} PID did not exit after SIGKILL`);
}
