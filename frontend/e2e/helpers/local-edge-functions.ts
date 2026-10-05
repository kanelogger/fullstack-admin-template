import { spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export interface LocalSupabaseLocation {
  frontendRoot: string;
  repositoryRoot: string;
  supabaseCli: string;
}

export async function captureCleanupFailure(
  failures: Error[],
  description: string,
  cleanup: () => unknown | Promise<unknown>
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    failures.push(new Error(description, { cause: error }));
  }
}

function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolveExit => {
    const finish = (exited: boolean) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("close", onExit);
      resolveExit(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    child.once("close", onExit);
    if (child.exitCode !== null || child.signalCode !== null) finish(true);
  });
}

export async function stopLocalEdgeServer(child: ChildProcess): Promise<void> {
  let lastError: unknown;
  for (const [signal, timeoutMs] of [
    ["SIGINT", 2_000],
    ["SIGTERM", 2_000],
    ["SIGKILL", 1_000]
  ] as const) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill(signal);
    } catch (error) {
      lastError = error;
    }
    if (await waitForProcessExit(child, timeoutMs)) return;
  }
  throw new Error("Local Edge Functions subprocess did not exit after SIGKILL", { cause: lastError });
}

export function localSupabaseStatus({ frontendRoot, repositoryRoot, supabaseCli }: LocalSupabaseLocation) {
  const result = spawnSync(supabaseCli, ["--workdir", repositoryRoot, "status", "--output", "json"], {
    cwd: frontendRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  if (result.error || result.status !== 0) throw new Error("Supabase Local is not running");
  let status;
  try {
    status = JSON.parse(result.stdout);
  } catch {
    throw new Error("Supabase Local status could not be read");
  }
  const url = status.API_URL ?? status.api_url;
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? status.SECRET_KEY;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url ?? "") || !publishableKey || !serviceRoleKey) {
    throw new Error("This test only accepts the project's local Supabase API");
  }
  return { url, publishableKey, serviceRoleKey };
}

export async function waitForFunctions(
  child: ChildProcess,
  url: string,
  publishableKey: string
): Promise<void> {
  const headers = {
    apikey: publishableKey,
    "Content-Type": "application/json",
    Origin: "http://127.0.0.1:8848"
  };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error("Local Edge Functions did not start");
    try {
      const login = await fetch(`${url}/functions/v1/session-login`, {
        method: "POST",
        headers,
        body: JSON.stringify({ loginName: "__codex_edge_readiness__", password: "invalid-test-password" })
      });
      const loginBody = await login.json().catch(() => null);
      const reset = await fetch(`${url}/functions/v1/password-reset`, {
        method: "POST",
        headers,
        body: JSON.stringify({ loginName: "__codex_edge_readiness__" })
      });
      const resetBody = await reset.json().catch(() => null);
      if (login.status === 401 && loginBody?.error?.code === "INVALID_CREDENTIALS" && reset.status === 200 && resetBody?.success) {
        return;
      }
    } catch {
      // Wait until the gateway and both function bundles answer their probes.
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
  }
  throw new Error("Local Edge Functions did not become ready");
}
