export class StartupCancelledError extends Error {
  constructor(reason) {
    super(`Dashboard startup cancelled: ${reason}`);
    this.name = "StartupCancelledError";
    this.reason = reason;
  }
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
