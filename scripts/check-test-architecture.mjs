import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadArchitectureRules } from "./test-architecture.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

export async function checkTestArchitecture(repositoryRoot = root) {
  const { rules } = await loadArchitectureRules(repositoryRoot);
  const frontendE2e = join(repositoryRoot, "frontend/e2e");
  const files = (await readdir(frontendE2e)).filter(path => path.endsWith(".spec.ts")).sort();
  const active = [...rules.allowedPlaywrightSpecs].sort();
  const errors = [];

  for (const file of files) if (!active.includes(file)) errors.push("Playwright spec is outside the active allowlist: " + file);
  for (const file of active) if (!files.includes(file)) errors.push("Allowed Playwright spec is missing: " + file);

  const config = await readFile(join(repositoryRoot, "frontend/playwright.config.ts"), "utf8");
  if (!config.includes("testMatch:")) errors.push("Playwright projects must declare explicit testMatch allowlists");
  if (config.includes("**/*.spec.ts")) errors.push("Playwright config contains a broad spec wildcard");
  for (const file of active) if (!config.includes(file)) errors.push("Allowed spec is absent from Playwright project allowlists: " + file);

  const packageManifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  if (Object.values(packageManifest.scripts ?? {}).some(command => /(?:test:e2e|\*-smoke\.spec)/.test(command))) {
    errors.push("A root script references the retired broad E2E entrypoint or smoke specs");
  }
  const workflow = await readFile(join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  for (const required of ["pnpm check:test-architecture", "pnpm test:browser", "pnpm test:visual"]) {
    if (!workflow.includes(required)) errors.push("CI does not run required test architecture gate: " + required);
  }
  if (/check:test-architecture[^\n]*--mode\s+acceptance/.test(workflow)) errors.push("CI must not run the interactive acceptance evidence gate");
  if (/pnpm\s+test:visual:update|pnpm\s+test:visual:accept/.test(workflow)) errors.push("CI must compare visual baselines without generating or accepting candidates");

  return { valid: errors.length === 0, activeSpecs: active, discoveredSpecs: files, errors };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) {
  checkTestArchitecture().then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.valid) process.exitCode = 1;
  }).catch(error => {
    process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
