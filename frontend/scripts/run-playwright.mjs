import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { playwrightArtifactEnvironment } from "../../scripts/playwright-artifacts.mjs";

const frontendRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const [artifactSet, ...args] = process.argv.slice(2);
if (!["mock", "visual"].includes(artifactSet) || args.length === 0) {
  throw new Error("Usage: node scripts/run-playwright.mjs <mock|visual> <playwright arguments...>");
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(pnpm, ["exec", "playwright", "test", ...args], {
  cwd: frontendRoot,
  stdio: "inherit",
  env: playwrightArtifactEnvironment(process.env, artifactSet),
  shell: process.platform === "win32"
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
