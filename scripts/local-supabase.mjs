import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export function getLocalSupabaseStatus(workdir = projectRoot) {
  const result = spawnSync(
    pnpm,
    ["--filter", "fullstack-admin-frontend", "exec", "supabase", "--workdir", workdir, "status", "--output", "json"],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error("Supabase Local must be running before this command");
  }

  let values;
  try {
    values = JSON.parse(result.stdout);
  } catch {
    throw new Error("Supabase Local status could not be read");
  }
  const url = values.API_URL ?? values.api_url;
  const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY ?? values.service_role_key ?? values.SECRET_KEY;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url ?? "")) {
    throw new Error("This command only accepts this template's local Supabase project");
  }
  if (!publishableKey || !serviceRoleKey) throw new Error("Local Supabase keys are unavailable");
  return { url, publishableKey, serviceRoleKey };
}
