import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { getLocalSupabaseStatus } from "./local-supabase.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const commands = [
  ["Supabase Edge Functions", ["functions:serve"]],
  ["Vue frontend", ["--filter", "fullstack-admin-frontend", "dev"]]
];
const children = [];
let stopping = false;

let localSupabase;
try {
  localSupabase = getLocalSupabaseStatus();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Supabase Local status could not be read");
  process.exit(1);
}

const childEnv = {
  ...process.env,
  SUPABASE_TELEMETRY_DISABLED: "1",
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? localSupabase.url,
  VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? localSupabase.publishableKey
};

function stopChildren(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill(signal);
  }
}

for (const [name, args] of commands) {
  const child = spawn(pnpm, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: childEnv
  });
  children.push(child);
  child.on("error", error => {
    console.error(`${name} could not start: ${error.message}`);
    process.exitCode = 1;
    stopChildren();
  });
  child.on("exit", (code, signal) => {
    if (!stopping && (code !== 0 || signal)) {
      process.exitCode = code ?? 1;
      stopChildren();
    }
  });
}

process.on("SIGINT", () => stopChildren("SIGINT"));
process.on("SIGTERM", () => stopChildren("SIGTERM"));
