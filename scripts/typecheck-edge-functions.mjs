import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const functions = ["session-login", "password-reset", "user-management"];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

for (const functionName of functions) {
  const result = spawnSync(pnpm, ["exec", "deno", "check", "--frozen", "index.ts"], {
    cwd: resolve(projectRoot, "supabase/functions", functionName),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DENO_NO_UPDATE_CHECK: "1" }
  });
  if (result.error) {
    console.error(`Edge type check could not start for ${functionName}. Install project dependencies with pnpm first.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
