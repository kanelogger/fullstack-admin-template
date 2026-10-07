import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontendRoot = join(projectRoot, "frontend");
const update = process.argv.length === 3 && process.argv[2] === "--update";
if (process.argv.length > 2 && !update) throw new Error("Usage: node scripts/run-visual-tests.mjs [--update]");

const temporaryRoot = await mkdtemp(join(os.tmpdir(), "fullstack-admin-visual-"));
const containerWorkspace = join(temporaryRoot, "workspace");
const image = "mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27";
const pnpmStore = resolve(spawnSync("pnpm", ["store", "path"], { cwd: projectRoot, encoding: "utf8" }).stdout.trim());
const excludedNames = new Set([
  ".git", ".agents", "node_modules", ".pnpm-store", ".vite", ".cache", "coverage",
  "playwright-report", "test-results", "dist", "target"
]);

async function copyArtifacts(sourceRoot, destinationRoot) {
  for (const name of ["playwright-report", "test-results"]) {
    const source = join(sourceRoot, "frontend", name);
    try {
      if (!(await stat(source)).isDirectory()) continue;
      const destination = join(destinationRoot, "frontend", name);
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

let dockerResult;
try {
  await cp(projectRoot, containerWorkspace, {
    recursive: true,
    filter: source => {
      const rel = relative(projectRoot, source);
      if (!rel || rel === ".") return true;
      const segments = rel.split(sep);
      if (segments.some(segment => excludedNames.has(segment) || segment.startsWith(".env"))) return false;
      if (segments.includes("supabase") && [".temp", ".branches"].some(name => segments.includes(name))) return false;
      return true;
    }
  });
  const imageArgs = [
    "run", "--rm", "--init", "--ipc=host",
    "--platform", "linux/amd64",
    "-e", `VISUAL_MODE=${update ? "update" : "check"}`,
    "-e", "CI=1",
    "-e", "VISUAL_BASELINE_RUN=1",
    "-e", "SUPABASE_TELEMETRY_DISABLED=1",
    "-v", `${containerWorkspace}:/workspace`,
    "-v", `${pnpmStore}:/workspace/node_modules/.pnpm-store/v11`,
    "-w", "/workspace",
    image,
    "bash", "/workspace/scripts/visual-tests-container.sh"
  ];
  dockerResult = spawnSync("docker", imageArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "inherit",
    timeout: 20 * 60_000
  });

  await copyArtifacts(containerWorkspace, projectRoot);
  if (dockerResult.error || dockerResult.status !== 0) {
    throw new Error(`Visual container failed (${dockerResult.error?.message ?? `exit code ${dockerResult.status ?? 1}`})`);
  }

  if (update) {
    const snapshotName = "dashboard-visual.spec.ts-snapshots";
    const candidate = join(containerWorkspace, "frontend", "e2e", snapshotName);
    const tracked = join(frontendRoot, "e2e", snapshotName);
    await rm(tracked, { recursive: true, force: true });
    await cp(candidate, tracked, { recursive: true });
    const files = await readdir(tracked);
    console.log(`Updated ${files.length} visual baselines. Review the diff before accepting them.`);
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
