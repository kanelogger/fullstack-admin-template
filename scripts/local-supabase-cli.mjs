import { spawnSync } from "node:child_process";
import { projectRoot } from "./local-supabase.mjs";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const action = process.argv[2];
const supported = new Set(["start", "stop", "status", "db-reset"]);
if (!supported.has(action)) {
  console.error("Usage: pnpm supabase:{start|stop|status|db:reset}");
  process.exit(2);
}

const cliAction = action === "db-reset" ? ["db", "reset", "--local"] : [action];
const result = spawnSync(pnpm, [
  "--filter", "fullstack-admin-frontend", "exec", "supabase",
  "--workdir", projectRoot,
  ...cliAction
], {
  cwd: projectRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
});

if (result.error || result.status !== 0) {
  console.error(`Supabase Local ${action} failed. Check that the configured Docker runtime is running.`);
  process.exit(result.status ?? 1);
}

if (action === "status") {
  try {
    const status = JSON.parse(result.stdout);
    console.log(JSON.stringify({
      projectId: status.project_id ?? status.PROJECT_ID,
      apiUrl: status.API_URL ?? status.api_url,
      publishableKey: status.PUBLISHABLE_KEY ?? status.ANON_KEY
    }, null, 2));
  } catch {
    console.error("Supabase Local status could not be read.");
    process.exitCode = 1;
  }
} else if (action === "start") {
  console.log("Supabase Local started. pnpm dev will read its local URL and publishable key automatically.");
} else if (action === "stop") {
  console.log("Supabase Local stopped.");
} else {
  console.log("The local Supabase database was reset and its migrations and seed were applied.");
}
