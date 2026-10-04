import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(frontendRoot, "..");
const supabaseCli = resolve(frontendRoot, "node_modules/.bin/supabase");
const result = spawnSync(
  supabaseCli,
  ["--workdir", repositoryRoot, "status", "--output", "json"],
  {
    cwd: frontendRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  }
);

if (result.error || result.status !== 0) {
  process.stderr.write("Supabase Local must be running for the real recovery-link browser test.\n");
  process.exitCode = 1;
} else {
  let status;
  try {
    status = JSON.parse(result.stdout);
  } catch {
    process.stderr.write("Supabase Local status was not readable.\n");
    process.exitCode = 1;
  }

  const apiUrl = status?.API_URL ?? status?.api_url;
  const publishableKey = status?.PUBLISHABLE_KEY ?? status?.ANON_KEY;
  if (
    typeof apiUrl !== "string" ||
    !/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(apiUrl) ||
    typeof publishableKey !== "string" || !publishableKey
  ) {
    process.stderr.write("The browser test accepts only this project's local Supabase URL and publishable key.\n");
    process.exitCode = 1;
  } else {
    const playwright = spawnSync(
      resolve(frontendRoot, "node_modules/.bin/playwright"),
      ["test", "e2e/auth-recovery-local.spec.ts", "--workers=1"],
      {
        cwd: frontendRoot,
        stdio: "inherit",
        env: {
          ...process.env,
          E2E_LOCAL_AUTH: "1",
          VITE_SUPABASE_URL: apiUrl,
          VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
          SUPABASE_TELEMETRY_DISABLED: "1"
        }
      }
    );
    process.exitCode = playwright.status ?? 1;
  }
}
