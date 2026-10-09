import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyFixedWorkspace, summarizeInputs, summarizeSnapshotInputs } from "./test-architecture.mjs";
import { acceptVisualCandidate, assertVisualBaselinesComplete, createVisualCandidate } from "./visual-baselines.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const image = "mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27";

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

function parseMode(args) {
  if (args.length === 1 && args[0] === "--update") return { mode: "candidate" };
  if (args[0] === "--accept") {
    const candidateIndex = args.indexOf("--candidate");
    if (candidateIndex < 0 || !args[candidateIndex + 1] || args.length !== candidateIndex + 2) {
      throw new Error("Usage: pnpm test:visual:accept -- --candidate <candidate-id>");
    }
    return { mode: "accept", candidateId: args[candidateIndex + 1] };
  }
  if (args.length === 0) return { mode: "check" };
  throw new Error("Usage: pnpm test:visual | pnpm test:visual:update | pnpm test:visual:accept -- --candidate <candidate-id>");
}

async function execute() {
  const mode = parseMode(process.argv.slice(2));
  if (mode.mode === "accept") {
    const result = await acceptVisualCandidate({ root: projectRoot, candidateId: mode.candidateId });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (mode.mode === "check") await assertVisualBaselinesComplete(projectRoot);
  const startingSummary = await summarizeInputs(projectRoot, "visual");
  const temporaryRoot = await mkdtemp(join(os.tmpdir(), "fullstack-admin-visual-"));
  const containerWorkspace = join(temporaryRoot, "workspace");
  try {
    const copied = await copyFixedWorkspace(projectRoot, containerWorkspace, "visual");
    if (copied.before.inputSha256 !== startingSummary.inputSha256 || copied.after.inputSha256 !== startingSummary.inputSha256) {
      throw new Error("Visual source changed while the fixed workspace copy was prepared");
    }
    const pnpmStoreResult = spawnSync("pnpm", ["store", "path"], { cwd: projectRoot, encoding: "utf8" });
    if (pnpmStoreResult.error || pnpmStoreResult.status !== 0 || !pnpmStoreResult.stdout.trim()) {
      throw new Error(`Could not locate the pnpm content store: ${pnpmStoreResult.error?.message ?? pnpmStoreResult.stderr ?? "empty path"}`);
    }
    const pnpmStore = resolve(pnpmStoreResult.stdout.trim());
    const dockerResult = spawnSync("docker", [
      "run", "--rm", "--init", "--ipc=host",
      ...(typeof process.getuid === "function" ? ["--user", `${process.getuid()}:${process.getgid()}`] : []),
      "-e", "HOME=/tmp/template-visual-home",
      "-e", "COREPACK_HOME=/tmp/template-visual-corepack",
      "--platform", "linux/amd64",
      "-e", `VISUAL_MODE=${mode.mode}`,
      "-e", "CI=1",
      "-e", "VISUAL_BASELINE_RUN=1",
      "-e", "SUPABASE_TELEMETRY_DISABLED=1",
      "-v", `${containerWorkspace}:/workspace`,
      "-v", `${pnpmStore}:/workspace/node_modules/.pnpm-store/v11`,
      "-w", "/workspace",
      image,
      "bash", "/workspace/scripts/visual-tests-container.sh"
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "inherit",
      timeout: 20 * 60_000
    });

    await copyArtifacts(containerWorkspace, projectRoot);
    if (dockerResult.error || dockerResult.status !== 0) {
      throw new Error(`Visual ${mode.mode} container failed (${dockerResult.error?.message ?? `exit code ${dockerResult.status ?? 1}`})`);
    }

    const snapshotSummary = await summarizeSnapshotInputs(containerWorkspace, "visual", startingSummary);
    const finalSummary = await summarizeInputs(projectRoot, "visual");
    if (snapshotSummary.inputSha256 !== startingSummary.inputSha256 || finalSummary.inputSha256 !== startingSummary.inputSha256 ||
        snapshotSummary.rulesSha256 !== startingSummary.rulesSha256 || finalSummary.rulesSha256 !== startingSummary.rulesSha256) {
      throw new Error("Visual worktree or fixed snapshot inputs changed during comparison");
    }

    if (mode.mode === "candidate") {
      const result = await createVisualCandidate({
        root: projectRoot,
        workspaceRoot: containerWorkspace,
        diagnosticsRoot: join(containerWorkspace, "visual/.runs/initial"),
        startingSummary
      });
      const operations = result.record.states.reduce((counts, state) => {
        counts[state.operation] = (counts[state.operation] ?? 0) + 1;
        return counts;
      }, {});
      process.stdout.write(`${JSON.stringify({ candidateId: result.candidateId, path: result.path, operations, stateCount: result.record.stateCount }, null, 2)}\n`);
    } else {
      process.stdout.write(`Visual comparison passed with ${startingSummary.fileCount} hashed inputs.\n`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  execute().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
