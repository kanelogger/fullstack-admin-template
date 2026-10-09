import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requireFrontend = createRequire(join(repositoryRoot, "frontend/package.json"));
const typescript = requireFrontend("typescript");
export const rulesPath = join(repositoryRoot, "scripts/test-architecture-rules.json");
export const assertionsPath = join(repositoryRoot, "scripts/test-architecture-assertions.json");

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const normalizePath = value => value.split(sep).join("/");
const isBrowserLedgerPath = path => path === "scripts/test-architecture-assertions.json";
const browserManagementFiles = new Set([
  "frontend/playwright.config.ts",
  "frontend/scripts/run-local-auth-e2e.mjs",
  "frontend/scripts/run-playwright.mjs",
  "scripts/check-test-architecture.mjs",
  "scripts/playwright-artifacts.mjs",
  "scripts/run-visual-tests.mjs",
  "scripts/test-architecture.mjs",
  "scripts/visual-baselines.mjs",
  "scripts/visual-tests-container.sh"
]);
const browserScenarioFiles = new Set([
  "project.yml",
  "scripts/agent-testing.mjs",
  "scripts/agent-testing-evidence.mjs",
  "scripts/agent-testing-helpers.mjs",
  "scripts/agent-testing-lifecycle.mjs",
  "scripts/check-migrations.mjs",
  "scripts/dev.mjs",
  "scripts/initial-admin-credentials.mjs",
  "scripts/setup-admin.mjs",
  "scripts/test-architecture-rules.json",
  "supabase/config.toml",
  "supabase/seed.sql"
]);
const isBrowserManagementPath = path => !isBrowserLedgerPath(path) && (
  path.startsWith("frontend/e2e/") ||
  (path.startsWith("frontend/src/") && path.endsWith(".test.ts")) ||
  (path.startsWith("supabase/functions/") && path.endsWith(".test.ts")) ||
  browserManagementFiles.has(path)
);
const isBrowserScenarioPath = path => browserScenarioFiles.has(path);
const isBrowserProductPath = path => !isBrowserLedgerPath(path) && !isBrowserManagementPath(path) && !isBrowserScenarioPath(path);
const safeEvidencePath = value => typeof value === "string" && value.startsWith("evidence/") &&
  !value.split("/").some(segment => segment === ".." || segment === "." || segment === "");

function readJson(path) {
  return readFile(path, "utf8").then(JSON.parse);
}

export async function loadArchitectureRules(root = repositoryRoot) {
  const path = join(root, "scripts/test-architecture-rules.json");
  const bytes = await readFile(path);
  const rules = JSON.parse(bytes.toString("utf8"));
  if (rules.schemaVersion !== 1 || typeof rules.rulesVersion !== "string") {
    throw new Error("Unsupported test-architecture rules schema");
  }
  return { rules, rulesSha256: sha256(bytes), rulesPath: path };
}

function isExcluded(path, rules) {
  if (rules.excludedPrefixes.some(prefix => path === prefix.slice(0, -1) || path.startsWith(prefix))) return true;
  const patterns = (rules.excludedPathPatterns ?? []).map(globToRegExp);
  if (patterns.some(pattern => pattern.test(path))) return true;
  if (path.split("/").some(segment => segment.startsWith(".env") || segment === ".DS_Store")) return true;
  if (path.includes("-snapshots/")) return true;
  return path.startsWith("frontend/e2e/") && rules.retiringPaths.includes(path);
}

function globToRegExp(glob) {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      index += 1;
      if (glob[index + 1] === "/") {
        index += 1;
        source += "(?:.*/)?";
      } else {
        source += ".*";
      }
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}

function included(path, purpose, rules) {
  if (isExcluded(path, rules)) return false;
  const prefixes = [...rules.commonIncludedPrefixes];
  const exact = [...rules.commonIncludedPaths];
  if (purpose === "browser") {
    prefixes.push(...rules.browserIncludedPrefixes);
    exact.push(...rules.browserIncludedPaths);
  } else if (purpose === "visual") {
    prefixes.push(...rules.visualIncludedPrefixes);
    exact.push(...rules.visualIncludedPaths);
  } else {
    throw new Error(`Unknown test input purpose: ${purpose}`);
  }
  return exact.includes(path) || prefixes.some(prefix => path.startsWith(prefix));
}

function gitFiles(root) {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not enumerate tracked and unignored worktree files: ${result.error?.message ?? result.stderr?.toString("utf8")}`);
  }
  return [...new Set(result.stdout.toString("utf8").split("\0").filter(Boolean))].sort();
}

async function fileRecord(root, path) {
  const absolute = join(root, ...path.split("/"));
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      const target = await readFile(absolute).catch(async () => Buffer.from(await realpath(absolute)));
      return { path, state: "symlink", sizeBytes: target.length, sha256: sha256(target) };
    }
    if (!info.isFile()) return { path, state: "unsupported", sizeBytes: null, sha256: null };
    const bytes = await readFile(absolute);
    return { path, state: "present", sizeBytes: bytes.length, sha256: sha256(bytes) };
  } catch (error) {
    if (error?.code === "ENOENT") return { path, state: "deleted", sizeBytes: null, sha256: null };
    throw error;
  }
}

function inputHash(files) {
  return sha256(Buffer.from(files.map(file => `${file.path}\0${file.state}\0${file.sha256 ?? "-"}\0${file.sizeBytes ?? "-"}\n`).join("")));
}

function inputPartitionHashes(files) {
  const productFiles = files.filter(file => isBrowserProductPath(file.path));
  const scenarioFiles = files.filter(file => isBrowserScenarioPath(file.path));
  const managementFiles = files.filter(file => isBrowserManagementPath(file.path));
  const ledgerFiles = files.filter(file => isBrowserLedgerPath(file.path));
  return {
    inputSha256: inputHash(files),
    productInputSha256: inputHash(productFiles),
    scenarioInputSha256: inputHash(scenarioFiles),
    managementInputSha256: inputHash(managementFiles),
    ledgerInputSha256: inputHash(ledgerFiles)
  };
}

export async function suiteInputSha256(root, suite, rules) {
  const normalizedRoot = resolve(root);
  const paths = gitFiles(normalizedRoot);
  const sharedPaths = new Set([
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "frontend/package.json"
  ]);
  const unitPaths = path => sharedPaths.has(path) ||
    (path.startsWith("frontend/src/") && path.endsWith(".test.ts")) ||
    (path.startsWith("supabase/functions/") && path.endsWith(".test.ts")) ||
    (path.startsWith("scripts/") && path !== "scripts/test-architecture-assertions.json") ||
    [
      "frontend/vitest.config.ts",
      "frontend/vitest.components.config.ts",
      "supabase/functions/deno.json",
      "supabase/functions/_shared/contracts/package.json"
    ].includes(path);
  const browserPaths = path => sharedPaths.has(path) ||
    path === "frontend/playwright.config.ts" ||
    path === "frontend/scripts/run-playwright.mjs" ||
    path === "scripts/playwright-artifacts.mjs" ||
    path === "scripts/test-architecture-rules.json" ||
    (path.startsWith("frontend/e2e/helpers/") && path.endsWith(".ts")) ||
    (path.startsWith("frontend/e2e/") && rules.allowedPlaywrightSpecs.includes(basename(path)));
  const predicate = suite === "pnpm test:unit"
    ? unitPaths
    : suite === "pnpm test:browser"
      ? browserPaths
      : null;
  if (!predicate) throw new Error(`Unknown verification suite: ${suite}`);
  const files = await Promise.all(paths.filter(predicate).map(path => fileRecord(normalizedRoot, path)));
  if (files.some(file => file.state === "unsupported")) throw new Error(`${suite} input inventory contains a non-regular filesystem entry`);
  return inputHash(files);
}

function inputRecordDifferences(leftFiles, rightFiles, predicate) {
  const left = new Map(leftFiles.map(file => [file.path, file]));
  const right = new Map(rightFiles.map(file => [file.path, file]));
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter(path => predicate(path) && JSON.stringify(left.get(path) ?? null) !== JSON.stringify(right.get(path) ?? null))
    .sort();
}

function checkRequiredPaths(paths, rules) {
  const pathSet = new Set(paths);
  const missing = rules.requiredPaths.filter(path => !pathSet.has(path));
  if (missing.length) throw new Error(`Required test input paths are missing from the workspace file inventory: ${missing.join(", ")}`);
}

export async function summarizeInputs(root = repositoryRoot, purpose = "browser") {
  const normalizedRoot = resolve(root);
  const { rules, rulesSha256 } = await loadArchitectureRules(normalizedRoot);
  const paths = gitFiles(normalizedRoot);
  checkRequiredPaths(paths, rules);
  const selected = paths.filter(path => included(path, purpose, rules));
  const files = await Promise.all(selected.map(path => fileRecord(normalizedRoot, path)));
  if (files.some(file => file.state === "unsupported")) {
    throw new Error("Test input inventory contains a non-regular filesystem entry");
  }
  const digests = inputPartitionHashes(files);
  return {
    schemaVersion: 1,
    purpose,
    rulesVersion: rules.rulesVersion,
    rulesSha256,
    fileCount: files.length,
    ...digests,
    files
  };
}

export async function summarizeFixedPaths(root, purpose, paths, expectedRulesSha256) {
  const normalizedRoot = resolve(root);
  const { rules, rulesSha256 } = await loadArchitectureRules(normalizedRoot);
  if (rulesSha256 !== expectedRulesSha256) throw new Error("Test input rules changed after the fixed snapshot was created");
  const normalizedPaths = [...new Set(paths)].sort();
  if (normalizedPaths.some(path => !included(path, purpose, rules))) {
    throw new Error("Fixed snapshot path list no longer matches the versioned input rules");
  }
  const files = await Promise.all(normalizedPaths.map(path => fileRecord(normalizedRoot, path)));
  const digests = inputPartitionHashes(files);
  return {
    schemaVersion: 1,
    purpose,
    rulesVersion: rules.rulesVersion,
    rulesSha256,
    fileCount: files.length,
    ...digests,
    files
  };
}

export async function summarizeSnapshotInputs(root, purpose, startingSummary) {
  if (!startingSummary || startingSummary.purpose !== purpose) throw new Error("Snapshot summaries require the matching start-of-run purpose summary");
  const observed = await summarizeInputs(root, purpose);
  const observedPaths = new Set(observed.files.map(file => file.path));
  const deletedAtStart = startingSummary.files.filter(file => file.state === "deleted" && !observedPaths.has(file.path));
  const files = [...observed.files, ...deletedAtStart].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { ...observed, fileCount: files.length, ...inputPartitionHashes(files), files };
}

export async function copyFixedWorkspace(sourceRoot, destinationRoot, purpose = "browser") {
  const before = await summarizeInputs(sourceRoot, purpose);
  const destination = resolve(destinationRoot);
  const source = resolve(sourceRoot);
  if (destination === source || destination.startsWith(`${source}${sep}`)) {
    throw new Error("Fixed workspace copy must be outside the source worktree");
  }
  const ignoredSegments = new Set([
    ".git", ".agents", "node_modules", ".pnpm-store", ".vite", ".cache", "coverage",
    "test-results", "playwright-report", "dist", "target", "visual/candidates"
  ]);
  const { cp, mkdir } = await import("node:fs/promises");
  await mkdir(dirname(destination), { recursive: true });
  try {
    await cp(source, destination, {
      recursive: true,
      filter: sourcePath => {
        const rel = relative(source, sourcePath);
        if (!rel || rel === ".") return true;
        const normalized = normalizePath(rel);
        const segments = normalized.split("/");
        if (normalized === "visual/candidates" || normalized.startsWith("visual/candidates/")) return false;
        if (normalized === "visual/.runs" || normalized.startsWith("visual/.runs/")) return false;
        if (segments.some(segment => ignoredSegments.has(segment) || segment.startsWith(".env"))) return false;
        if (segments.includes(".temp") || segments.includes(".branches")) return false;
        return true;
      }
    });
    const initialized = spawnSync("git", ["init", "--quiet"], { cwd: destination, stdio: "ignore" });
    if (initialized.error || initialized.status !== 0) throw new Error("Could not initialize the isolated snapshot inventory");
    const indexed = spawnSync("git", ["add", "-A"], { cwd: destination, stdio: "ignore" });
    if (indexed.error || indexed.status !== 0) throw new Error("Could not index the isolated snapshot inputs");
    const copy = await summarizeSnapshotInputs(destination, purpose, before);
    const after = await summarizeInputs(source, purpose);
    if (before.inputSha256 !== copy.inputSha256 || before.inputSha256 !== after.inputSha256) {
      throw new Error("Worktree or fixed snapshot inputs changed while the run copy was being created");
    }
    return { before, copy, after, destination };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

function checkpointMap(rules, scenario) {
  const checkpoints = rules.scenarios[scenario];
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) throw new Error(`Unknown BrowserSkill scenario: ${scenario}`);
  return new Map(checkpoints.map(checkpoint => [checkpoint.id, checkpoint]));
}

export async function initializeScenarioReport({ runId, scenario, inputSummary, snapshotSummary, browser, appOrigin, startedAt = new Date().toISOString(), root = repositoryRoot }) {
  const { rules } = await loadArchitectureRules(root);
  const checkpoints = checkpointMap(rules, scenario);
  return {
    schemaVersion: 2,
    runId,
    purpose: "browser",
    scenario,
    rulesVersion: rules.rulesVersion,
    rulesSha256: inputSummary.rulesSha256,
    inputSummary,
    snapshotSummary,
    inputSha256AtStart: inputSummary.inputSha256,
    inputSha256InSnapshot: snapshotSummary.inputSha256,
    inputSha256AtEnd: null,
    inputSha256InSnapshotAtEnd: null,
    browser: browser ?? null,
    appOrigin: appOrigin ?? null,
    startedAt,
    finishedAt: null,
    productStatus: "Unknown",
    productReason: null,
    cleanupStatus: "Pending",
    evidenceStatus: "Pending",
    requiredEvidence: [...rules.runRequiredEvidence],
    evidence: [],
    checkpoints: Object.fromEntries([...checkpoints.values()].map(checkpoint => [checkpoint.id, {
      status: "Unknown",
      expected: checkpoint.expected,
      observed: "",
      evidence: []
    }]))
  };
}

export async function recordScenarioCheckpoint(reportPath, { checkpointId, status, observed, evidence = [] }, root = repositoryRoot) {
  if (!reportPath || !isAbsolute(reportPath)) throw new Error("Report path must be absolute");
  if (!["Pass", "Fail", "Unknown", "Skipped"].includes(status)) throw new Error("Invalid checkpoint status");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const { rules } = await loadArchitectureRules(root);
  const expected = checkpointMap(rules, report.scenario);
  if (!expected.has(checkpointId) || !report.checkpoints?.[checkpointId]) throw new Error(`Unknown checkpoint ID: ${checkpointId}`);
  if (typeof observed !== "string" || !observed.trim()) throw new Error("Checkpoint observations must be recorded");
  if (!Array.isArray(evidence) || evidence.some(path => !safeEvidencePath(path))) throw new Error("Evidence references must be relative evidence/ paths");
  report.checkpoints[checkpointId] = { status, expected: expected.get(checkpointId).expected, observed: observed.trim(), evidence: [...new Set(evidence)] };
  const temporary = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, reportPath);
  return report;
}

async function verifyEvidenceFile(path) {
  let info;
  try { info = await stat(path); } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    return `unreadable: ${error.message}`;
  }
  if (!info.isFile() || info.size === 0) return "empty or not a file";
  if (path.endsWith(".png")) {
    const bytes = await readFile(path);
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "invalid PNG signature";
  }
  if (path.endsWith(".json")) {
    try { JSON.parse(await readFile(path, "utf8")); } catch { return "invalid JSON"; }
  }
  return null;
}

function validateInputSummary(summary, label, errors) {
  if (!summary || !Array.isArray(summary.files)) {
    errors.push(`${label} input summary has no file manifest`);
    return null;
  }
  const hashes = inputPartitionHashes(summary.files);
  if (summary.inputSha256 !== hashes.inputSha256) errors.push(`${label} file manifest does not match its combined digest`);
  if (summary.productInputSha256 !== undefined && summary.productInputSha256 !== hashes.productInputSha256) {
    errors.push(`${label} file manifest does not match its product digest`);
  }
  if (summary.scenarioInputSha256 !== undefined && summary.scenarioInputSha256 !== hashes.scenarioInputSha256) {
    errors.push(`${label} file manifest does not match its scenario-input digest`);
  }
  if (summary.managementInputSha256 !== undefined && summary.managementInputSha256 !== hashes.managementInputSha256) {
    errors.push(`${label} file manifest does not match its management digest`);
  }
  if (summary.ledgerInputSha256 !== undefined && summary.ledgerInputSha256 !== hashes.ledgerInputSha256) {
    errors.push(`${label} file manifest does not match its acceptance-ledger digest`);
  }
  return hashes;
}

function verifyBrowserDebugBinding(debug, report) {
  const errors = [];
  const candidates = [
    ...(debug?.run && typeof debug.run === "object" ? [debug.run] : []),
    ...(Array.isArray(debug?.runs) ? debug.runs.filter(run => run && typeof run === "object") : [])
  ];
  const uniqueRuns = [...new Map(candidates.map(run => [
    [run.id, run.session_id, run.started_at, run.url].join("\0"),
    run
  ])).values()];
  if (uniqueRuns.length !== 1) return ["BrowserSkill debug evidence must contain exactly one capture run"];
  const run = uniqueRuns[0];

  const sessionId = report.browser?.sessionId;
  if (typeof sessionId !== "string" || !sessionId) errors.push("report does not identify its BrowserSkill session");
  else if (run.session_id !== sessionId) errors.push("BrowserSkill debug session does not match the report session");

  try {
    const expectedOrigin = new URL(report.appOrigin).origin;
    const capturedOrigin = new URL(run.url).origin;
    if (capturedOrigin !== expectedOrigin) errors.push("BrowserSkill debug app origin does not match the report origin");
  } catch {
    errors.push("BrowserSkill debug run or report has an invalid application URL");
  }

  const reportStart = Date.parse(report.startedAt);
  const reportEnd = Date.parse(report.finishedAt);
  const captureStart = Number(run.started_at);
  const endTimes = [run.stopped_at, run.saved_at, debug.saved_at].map(Number).filter(Number.isFinite);
  const captureEnd = endTimes.length ? Math.max(...endTimes) : Number.NaN;
  const toleranceMs = 5_000;
  if (![reportStart, reportEnd, captureStart, captureEnd].every(Number.isFinite)) {
    errors.push("BrowserSkill evidence and report must include valid capture timestamps");
  } else {
    if (reportEnd < reportStart) errors.push("report end time precedes its start time");
    if (captureStart < reportStart - toleranceMs || captureStart > reportEnd + toleranceMs) {
      errors.push("BrowserSkill capture start falls outside the report time window");
    }
    if (captureEnd < captureStart || captureEnd > reportEnd + toleranceMs) {
      errors.push("BrowserSkill capture end falls outside the report time window");
    }
  }
  if (run.state !== "stopped") errors.push("BrowserSkill evidence run was not stopped before export");
  return errors;
}

export async function verifyScenarioReport(report, { reportDirectory, currentSummary, root = repositoryRoot } = {}) {
  const errors = [];
  const { rules, rulesSha256 } = await loadArchitectureRules(root);
  if (report.schemaVersion !== 2) errors.push("report schema is not version 2");
  if (report.purpose !== "browser") errors.push("report purpose is not BrowserSkill");
  if (!rules.scenarios[report.scenario]) errors.push("report scenario is not registered");
  if (report.rulesVersion !== rules.rulesVersion || report.rulesSha256 !== rulesSha256) errors.push("input rules version or hash does not match");
  if (report.inputSha256AtStart !== report.inputSha256InSnapshot) {
    errors.push("worktree and fixed snapshot inputs differ at run start");
  }
  if (report.inputSha256InSnapshot !== report.inputSha256InSnapshotAtEnd) {
    errors.push("fixed snapshot inputs changed during the run");
  }
  if (report.inputSummary?.purpose !== "browser" || report.inputSummary?.inputSha256 !== report.inputSha256AtStart ||
      report.inputSummary?.rulesSha256 !== report.rulesSha256) {
    errors.push("starting input summary does not match the report's recorded digest fields");
  }
  if (report.snapshotSummary?.purpose !== "browser" || report.snapshotSummary?.inputSha256 !== report.inputSha256InSnapshot ||
      report.snapshotSummary?.rulesSha256 !== report.rulesSha256) {
    errors.push("fixed snapshot summary does not match the report's recorded digest fields");
  }
  if (report.inputSummaryAtEnd?.purpose !== "browser" || report.inputSummaryAtEnd?.inputSha256 !== report.inputSha256AtEnd ||
      report.inputSummaryAtEnd?.rulesSha256 !== report.rulesSha256) {
    errors.push("end-of-run worktree summary does not match the report's recorded digest fields");
  }
  if (report.snapshotSummaryAtEnd?.purpose !== "browser" || report.snapshotSummaryAtEnd?.inputSha256 !== report.inputSha256InSnapshotAtEnd ||
      report.snapshotSummaryAtEnd?.rulesSha256 !== report.rulesSha256) {
    errors.push("end-of-run fixed snapshot summary does not match the report's recorded digest fields");
  }
  if (report.productStatus !== "Pass") errors.push(`product status is ${report.productStatus ?? "missing"}`);
  if (report.cleanupStatus !== "Succeeded") errors.push(`cleanup status is ${report.cleanupStatus ?? "missing"}`);
  if (report.evidenceStatus !== "Complete") errors.push(`evidence status is ${report.evidenceStatus ?? "missing"}`);
  if (!report.finishedAt || !report.startedAt) errors.push("report is missing run timestamps");

  const summaryHashes = [
    validateInputSummary(report.inputSummary, "starting", errors),
    validateInputSummary(report.snapshotSummary, "starting fixed snapshot", errors),
    validateInputSummary(report.inputSummaryAtEnd, "ending", errors),
    validateInputSummary(report.snapshotSummaryAtEnd, "ending fixed snapshot", errors)
  ];
  const reportedProductHash = summaryHashes[0]?.productInputSha256;
  const reportedScenarioHash = summaryHashes[0]?.scenarioInputSha256;
  if (summaryHashes.some(hashes => hashes && hashes.productInputSha256 !== reportedProductHash)) {
    errors.push("product inputs changed between the worktree and fixed snapshots during the run");
  }
  if (summaryHashes.some(hashes => hashes && hashes.scenarioInputSha256 !== reportedScenarioHash)) {
    errors.push("scenario execution inputs changed between the worktree and fixed snapshots during the run");
  }
  if ([report.inputSummary, report.snapshotSummary, report.inputSummaryAtEnd, report.snapshotSummaryAtEnd]
    .some(summary => summary && summary.rulesSha256 !== report.rulesSha256)) {
    errors.push("input rules changed between the worktree and fixed snapshots during the run");
  }

  const currentHashes = validateInputSummary(currentSummary, "current worktree", errors);
  let managementDrift = [];
  let ledgerDrift = [];
  let scenarioDrift = [];
  if (!currentSummary || report.rulesSha256 !== currentSummary.rulesSha256) {
    errors.push("current worktree input rules do not match the report");
  } else if (reportedProductHash !== currentHashes?.productInputSha256) {
    const changedProductPaths = inputRecordDifferences(
      report.inputSummary?.files ?? [],
      currentSummary.files,
      isBrowserProductPath
    );
    errors.push(`current product inputs do not match the report${changedProductPaths.length ? `: ${changedProductPaths.join(", ")}` : ""}`);
  } else if (reportedScenarioHash !== currentHashes?.scenarioInputSha256) {
    scenarioDrift = inputRecordDifferences(
      report.inputSummary?.files ?? [],
      currentSummary.files,
      isBrowserScenarioPath
    );
    errors.push(`current scenario execution inputs do not match the report${scenarioDrift.length ? `: ${scenarioDrift.join(", ")}` : ""}`);
  } else {
    managementDrift = inputRecordDifferences(
      report.inputSummary?.files ?? [],
      currentSummary.files,
      isBrowserManagementPath
    );
    ledgerDrift = inputRecordDifferences(
      report.inputSummary?.files ?? [],
      currentSummary.files,
      isBrowserLedgerPath
    );
  }

  let expected;
  try { expected = checkpointMap(rules, report.scenario); } catch (error) { return { valid: false, errors: [...errors, error.message] }; }
  const actual = report.checkpoints ?? {};
  for (const checkpointId of expected.keys()) {
    const entry = actual[checkpointId];
    if (!entry) {
      errors.push(`required checkpoint is missing: ${checkpointId}`);
      continue;
    }
    if (entry.status !== "Pass") errors.push(`${checkpointId} status is ${entry.status ?? "missing"}`);
    if (typeof entry.observed !== "string" || !entry.observed.trim()) errors.push(`${checkpointId} has no observed result`);
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) errors.push(`${checkpointId} has no evidence references`);
    for (const requiredRef of rules.checkpointRequiredEvidence) {
      if (!entry.evidence?.includes(requiredRef)) errors.push(`${checkpointId} is missing required evidence reference ${requiredRef}`);
    }
    for (const ref of entry.evidence ?? []) {
      if (!safeEvidencePath(ref)) {
        errors.push(`${checkpointId} contains an invalid evidence reference`);
        continue;
      }
      const evidenceError = await verifyEvidenceFile(join(reportDirectory, ...ref.split("/")));
      if (evidenceError) errors.push(`${checkpointId} evidence ${ref}: ${evidenceError}`);
    }
  }
  for (const checkpointId of Object.keys(actual)) if (!expected.has(checkpointId)) errors.push(`unknown checkpoint is present: ${checkpointId}`);

  const allEvidence = [...new Set([...(report.requiredEvidence ?? []), ...(report.evidence ?? [])])];
  for (const ref of rules.runRequiredEvidence) {
    if (!allEvidence.includes(ref)) errors.push(`required run evidence is not registered: ${ref}`);
  }
  for (const ref of allEvidence) {
    if (!safeEvidencePath(ref)) {
      errors.push("run contains an invalid evidence reference");
      continue;
    }
    const evidencePath = join(reportDirectory, ...ref.split("/"));
    const evidenceError = await verifyEvidenceFile(evidencePath);
    if (evidenceError) errors.push(`run evidence ${ref}: ${evidenceError}`);
    if (ref === "evidence/browser-debug.json" && !evidenceError) {
      try {
        const debug = JSON.parse(await readFile(evidencePath, "utf8"));
        errors.push(...verifyBrowserDebugBinding(debug, report));
      } catch { errors.push("BrowserSkill debug evidence is not readable JSON"); }
    }
  }
  return { valid: errors.length === 0, errors, managementDrift, ledgerDrift, scenarioDrift };
}

export async function verifyReportSet({ reportPaths, scenarios, root = repositoryRoot } = {}) {
  if (!Array.isArray(reportPaths) || reportPaths.length === 0) return { valid: false, errors: ["an explicit non-empty report set is required"] };
  const rulesInfo = await loadArchitectureRules(root);
  const targetScenarios = scenarios ?? Object.keys(rulesInfo.rules.scenarios);
  const currentSummary = await summarizeInputs(root, "browser");
  const errors = [];
  const passed = new Map();
  const managementDrift = {};
  const ledgerDrift = {};
  const scenarioDrift = {};
  for (const path of reportPaths) {
    const absolute = resolve(path);
    let report;
    try { report = await readJson(absolute); } catch (error) {
      errors.push(`${absolute}: could not read report (${error.message})`);
      continue;
    }
    const verification = await verifyScenarioReport(report, { reportDirectory: dirname(absolute), currentSummary, root });
    if (!verification.valid) errors.push(...verification.errors.map(error => `${report.runId ?? absolute}: ${error}`));
    if (verification.managementDrift?.length) managementDrift[report.scenario] = verification.managementDrift;
    if (verification.ledgerDrift?.length) ledgerDrift[report.scenario] = verification.ledgerDrift;
    if (verification.scenarioDrift?.length) scenarioDrift[report.scenario] = verification.scenarioDrift;
    if (passed.has(report.scenario)) errors.push(`more than one report supplied for scenario ${report.scenario}`);
    passed.set(report.scenario, report.runId ?? absolute);
  }
  for (const scenario of targetScenarios) if (!passed.has(scenario)) errors.push(`no report supplied for scenario ${scenario}`);
  for (const scenario of passed.keys()) if (!targetScenarios.includes(scenario)) errors.push(`unexpected scenario report supplied: ${scenario}`);
  return {
    valid: errors.length === 0,
    errors,
    reports: Object.fromEntries(passed),
    managementDrift,
    ledgerDrift,
    scenarioDrift,
    scenarioInputSha256: currentSummary.scenarioInputSha256,
    currentSummary
  };
}

export function parsePlaywrightTestCases(source) {
  const sourceFile = typescript.createSourceFile("playwright.spec.ts", source, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TS);
  const isTestCall = node => {
    if (!typescript.isCallExpression(node)) return false;
    const expression = node.expression;
    if (typescript.isIdentifier(expression)) return ["test", "it"].includes(expression.text);
    return typescript.isPropertyAccessExpression(expression) &&
      typescript.isIdentifier(expression.expression) &&
      ["test", "it"].includes(expression.expression.text) &&
      ["skip", "fixme", "only"].includes(expression.name.text);
  };
  const isAssertionCall = node => {
    if (!typescript.isCallExpression(node)) return false;
    const expression = node.expression;
    if (typescript.isIdentifier(expression)) return expression.text === "expect";
    return typescript.isPropertyAccessExpression(expression) &&
      typescript.isIdentifier(expression.expression) &&
      expression.expression.text === "expect" &&
      ["poll", "soft"].includes(expression.name.text);
  };
  const results = [];
  const visit = node => {
    if (isTestCall(node) && node.arguments.length >= 2 && typescript.isStringLiteralLike(node.arguments[0])) {
      const body = node.arguments[1];
      const assertions = [];
      const visitBody = current => {
        if (isAssertionCall(current)) {
          let statement = current;
          for (let parent = current.parent; parent && parent !== body; parent = parent.parent) {
            if (typescript.isStatement(parent)) {
              statement = parent;
              break;
            }
          }
          const index = assertions.length + 1;
          const sourceText = statement.getText(sourceFile).trim().replace(/\s+/g, " ");
          const line = sourceFile.getLineAndCharacterOfPosition(current.getStart(sourceFile)).line + 1;
          assertions.push({
            index,
            line,
            source: sourceText,
            fingerprint: sha256(Buffer.from(`${index}\0${sourceText}`))
          });
        }
        typescript.forEachChild(current, visitBody);
      };
      visitBody(body);
      results.push({ name: node.arguments[0].text, assertionCount: assertions.length, assertions });
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return results;
}

function isRepositoryRelativePath(path) {
  return typeof path === "string" && path.length > 0 && !isAbsolute(path) &&
    !path.split(/[\\/]/).some(segment => segment === ".." || segment === "." || segment === "");
}

export async function validateAssertionCoverage(assertion, {
  absoluteRoot,
  batchScenarios,
  manifest,
  rules,
  verifiedReports,
  currentSummary,
  suiteInputDigests = {},
  requireFreshEvidence = true
}) {
  const errors = [];
  if (!["replaced", "retained"].includes(assertion.disposition)) {
    errors.push("assertion must have an explicit replaced or retained disposition");
  }
  if (assertion.disposition === "retained" && (typeof assertion.rationale !== "string" || !assertion.rationale.trim())) {
    errors.push("retained assertion requires a reviewable rationale");
  }
  if (!Array.isArray(assertion.coverage) || assertion.coverage.length === 0) {
    return [...errors, "no assertion-specific replacement or retained reason is registered"];
  }
  for (const coverage of assertion.coverage) {
    if (coverage.kind === "retained") {
      if (typeof coverage.reason !== "string" || !coverage.reason.trim()) {
        errors.push("retained coverage requires a reviewable reason");
      }
      continue;
    }
    if (coverage.kind === "browser") {
      if (!batchScenarios.includes(coverage.scenario)) {
        errors.push(`BrowserSkill coverage is outside this batch (${coverage.scenario})`);
      }
      if (typeof coverage.runId !== "string" || !coverage.runId.trim()) {
        errors.push(`BrowserSkill coverage is missing a runId for ${coverage.scenario}`);
      } else if (typeof coverage.checkpoint !== "string" || !coverage.checkpoint.trim()) {
        errors.push(`BrowserSkill coverage is missing a checkpoint for ${coverage.scenario}`);
      } else if (requireFreshEvidence) {
        const browserReport = manifest.verification?.browserReports?.[coverage.scenario];
        const browserRunId = typeof browserReport === "string" ? browserReport : browserReport?.runId;
        if (browserReport?.status !== "Pass" || !browserRunId || browserRunId !== coverage.runId ||
            verifiedReports[coverage.scenario] !== coverage.runId ||
            browserReport.productInputSha256 !== currentSummary.productInputSha256 ||
            browserReport.scenarioInputSha256 !== currentSummary.scenarioInputSha256) {
          errors.push(`BrowserSkill coverage does not reference the verified report for ${coverage.scenario}`);
        }
      }
      const checkpoints = rules.scenarios[coverage.scenario] ?? [];
      if (!checkpoints.some(checkpoint => checkpoint.id === coverage.checkpoint)) {
        errors.push(`BrowserSkill checkpoint is not registered (${coverage.scenario}/${coverage.checkpoint})`);
      }
      continue;
    }
    const suite = ["service", "store", "component", "contract"].includes(coverage.kind)
      ? "pnpm test:unit"
      : coverage.kind === "playwright"
        ? "pnpm test:browser"
        : null;
    if (!suite || coverage.suite !== suite || !isRepositoryRelativePath(coverage.path) || !coverage.testName) {
      errors.push("replacement must name a supported test, file and verification suite");
      continue;
    }
    if (requireFreshEvidence) {
      const verification = manifest.verification?.suites?.[suite];
      const suiteDigest = suiteInputDigests[suite] ?? await suiteInputSha256(absoluteRoot, suite, rules);
      if (verification?.status !== "Pass" ||
          verification.productInputSha256 !== currentSummary.productInputSha256 ||
          verification.inputSha256 !== suiteDigest) {
        errors.push(`replacement suite ${suite} has no passing result for the current inputs`);
      }
    }
    if (coverage.kind === "playwright" && !rules.allowedPlaywrightSpecs.includes(basename(coverage.path))) {
      errors.push(`replacement Playwright spec is not active (${coverage.path})`);
    }
    try {
      const replacementSource = await readFile(join(absoluteRoot, ...coverage.path.split("/")), "utf8");
      if (!parsePlaywrightTestCases(replacementSource).some(replacement => replacement.name === coverage.testName)) {
        errors.push(`replacement test not found (${coverage.path} :: ${coverage.testName})`);
      }
    } catch {
      errors.push(`replacement file does not exist (${coverage.path})`);
    }
  }
  return errors;
}

export async function retireBatch({ batchName, reportPaths, root = repositoryRoot, manifestPath = assertionsPath } = {}) {
  const absoluteRoot = resolve(root);
  const { rules } = await loadArchitectureRules(absoluteRoot);
  const batch = rules.retirementBatches[batchName];
  if (!batch) throw new Error(`Unknown retirement batch: ${batchName}`);
  const verification = await verifyReportSet({ reportPaths, scenarios: batch.scenarios, root: absoluteRoot });
  if (!verification.valid) return { deleted: [], errors: verification.errors };
  const suiteInputDigests = Object.fromEntries(await Promise.all(["pnpm test:unit", "pnpm test:browser"].map(async suite => [
    suite,
    await suiteInputSha256(absoluteRoot, suite, rules)
  ])));

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.cases)) throw new Error("Invalid assertion retirement manifest");
  const retiredPaths = Array.isArray(manifest.retiredPaths) ? manifest.retiredPaths : [];
  if (retiredPaths.some(path => !rules.retiringPaths.includes(path)) || new Set(retiredPaths).size !== retiredPaths.length) {
    throw new Error("Assertion manifest contains invalid retired paths");
  }
  if (manifest.verification?.productInputSha256 !== verification.currentSummary.productInputSha256 ||
      manifest.verification?.scenarioInputSha256 !== verification.currentSummary.scenarioInputSha256 ||
      manifest.verification?.managementInputSha256 !== verification.currentSummary.managementInputSha256) {
    return { deleted: [], errors: ["Assertion mappings do not have passing results for the current product and management inputs"] };
  }
  const alreadyRetired = batch.paths.filter(path => retiredPaths.includes(path));
  if (alreadyRetired.length) return { deleted: [], errors: [`Batch contains already retired files: ${alreadyRetired.join(", ")}`] };
  const candidates = [];
  const errors = [];
  for (const path of batch.paths) {
    if (!rules.retiringPaths.includes(path)) {
      errors.push(`${path}: file is not registered as retiring`);
      continue;
    }
    const fullPath = join(absoluteRoot, ...path.split("/"));
    const sourceInfo = await lstat(fullPath).catch(() => null);
    if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) {
      errors.push(`${path}: retirement target must be a regular non-symlink file`);
      continue;
    }
    let source;
    try { source = await readFile(fullPath, "utf8"); } catch (error) {
      errors.push(`${path}: cannot read candidate (${error.message})`);
      continue;
    }
    const testCases = parsePlaywrightTestCases(source);
    const names = testCases.map(entry => entry.name);
    if (!testCases.length) errors.push(`${path}: no named Playwright tests found`);
    const mappings = manifest.cases.filter(entry => entry.path === path);
    if (mappings.length !== testCases.length) errors.push(`${path}: assertion manifest has stale, duplicate or missing test cases`);
    for (const testCase of testCases) {
      const mapping = mappings.find(entry => entry.name === testCase.name);
      const assertionMaps = mapping?.assertions;
      if (!mapping || Object.hasOwn(mapping, "coverage") || mapping.assertionCount !== testCase.assertionCount ||
          !Array.isArray(assertionMaps) || assertionMaps.length !== testCase.assertions.length) {
        errors.push(`${path} :: ${testCase.name}: explicit assertion records are missing or stale`);
        continue;
      }
      for (const [assertionIndex, actualAssertion] of testCase.assertions.entries()) {
        const assertion = assertionMaps[assertionIndex];
        const label = `${path} :: ${testCase.name} :: assertion ${assertionIndex + 1}`;
        if (!assertion || assertion.index !== actualAssertion.index || assertion.line !== actualAssertion.line ||
            assertion.fingerprint !== actualAssertion.fingerprint || assertion.source !== actualAssertion.source) {
          errors.push(`${label}: source assertion fingerprint is missing or stale`);
          continue;
        }
        errors.push(...(await validateAssertionCoverage(assertion, {
          absoluteRoot,
          batchScenarios: batch.scenarios,
          manifest,
          rules,
          verifiedReports: verification.reports,
          currentSummary: verification.currentSummary,
          suiteInputDigests
        })).map(error => `${label}: ${error}`));
      }
    }
    if (mappings.some(entry => !names.includes(entry.name))) errors.push(`${path}: retirement manifest contains stale test names`);
    const sourceBytes = Buffer.from(source);
    const fileDigest = sha256(sourceBytes);
    const fileManifest = manifest.files?.find(entry => entry.path === path);
    if (!fileManifest || fileManifest.sha256 !== fileDigest) errors.push(`${path}: source digest does not match the reviewed assertion manifest`);
    candidates.push({ path, fullPath, source, fileMode: sourceInfo.mode & 0o777 });
  }
  if (errors.length) return { deleted: [], errors };

  const finalSummary = await summarizeInputs(absoluteRoot, "browser");
  if (finalSummary.inputSha256 !== verification.currentSummary.inputSha256 || finalSummary.rulesSha256 !== verification.currentSummary.rulesSha256) {
    return { deleted: [], errors: ["worktree inputs changed after verification; no registered file was deleted"] };
  }

  const quarantined = [];
  try {
    for (const candidate of candidates) {
      const quarantinePath = `${candidate.fullPath}.retire-${randomUUID()}.tmp`;
      await rename(candidate.fullPath, quarantinePath);
      quarantined.push({ candidate, quarantinePath });
      const movedDigest = sha256(await readFile(quarantinePath));
      const expectedDigest = manifest.files.find(entry => entry.path === candidate.path)?.sha256;
      if (movedDigest !== expectedDigest) throw new Error(`${candidate.path}: source changed during retirement`);
    }
    for (const item of quarantined) await rm(item.quarantinePath);
  } catch (error) {
    const rollbackErrors = [];
    const movedPaths = new Set(quarantined.map(item => item.candidate.fullPath));
    for (const candidate of [...candidates].reverse()) {
      try {
        const item = quarantined.find(entry => entry.candidate === candidate);
        if (item) {
          const exists = await lstat(item.quarantinePath).then(() => true).catch(() => false);
          if (exists) await rename(item.quarantinePath, candidate.fullPath);
          else await writeFile(candidate.fullPath, candidate.source, { mode: candidate.fileMode, flag: "wx" });
        } else if (movedPaths.has(candidate.fullPath)) {
          await writeFile(candidate.fullPath, candidate.source, { mode: candidate.fileMode, flag: "wx" });
        }
      } catch (rollbackError) { rollbackErrors.push(`${candidate.path}: ${rollbackError.message}`); }
    }
    return { deleted: [], errors: [`Retirement failed and attempted rollback: ${error.message}`, ...rollbackErrors] };
  }

  const nextManifest = {
    ...manifest,
    retiredPaths: [...new Set([...retiredPaths, ...batch.paths])].sort()
  };
  const manifestInfo = await lstat(manifestPath);
  const temporaryManifest = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    const postRetirementSummary = await summarizeInputs(absoluteRoot, "browser");
    if (postRetirementSummary.productInputSha256 !== verification.currentSummary.productInputSha256 ||
        postRetirementSummary.rulesSha256 !== verification.currentSummary.rulesSha256) {
      throw new Error("Product inputs or rules changed during retirement; no assertion ledger update was committed");
    }
    const postSuiteInputDigests = Object.fromEntries(await Promise.all(Object.keys(suiteInputDigests).map(async suite => [
      suite,
      await suiteInputSha256(absoluteRoot, suite, rules)
    ])));
    if (Object.keys(suiteInputDigests).some(suite => postSuiteInputDigests[suite] !== suiteInputDigests[suite])) {
      throw new Error("Verification suite inputs changed during retirement; no assertion ledger update was committed");
    }
    nextManifest.verification = {
      ...nextManifest.verification,
      productInputSha256: postRetirementSummary.productInputSha256,
      scenarioInputSha256: postRetirementSummary.scenarioInputSha256,
      managementInputSha256: postRetirementSummary.managementInputSha256,
      suites: Object.fromEntries(Object.entries(nextManifest.verification.suites).map(([suite, result]) => [suite, {
        ...result,
        productInputSha256: postRetirementSummary.productInputSha256,
        inputSha256: postSuiteInputDigests[suite]
      }])),
      browserReports: Object.fromEntries(Object.entries(nextManifest.verification.browserReports).map(([scenario, result]) => [scenario, {
        ...result,
        productInputSha256: postRetirementSummary.productInputSha256,
        scenarioInputSha256: postRetirementSummary.scenarioInputSha256
      }]))
    };
    await writeFile(temporaryManifest, `${JSON.stringify(nextManifest, null, 2)}\n`, {
      mode: manifestInfo.mode & 0o777,
      flag: "wx"
    });
    await rename(temporaryManifest, manifestPath);
  } catch (error) {
    await rm(temporaryManifest, { force: true }).catch(() => undefined);
    const rollbackErrors = [];
    for (const candidate of [...candidates].reverse()) {
      try {
        const exists = await lstat(candidate.fullPath).then(() => true).catch(() => false);
        if (!exists) await writeFile(candidate.fullPath, candidate.source, { mode: candidate.fileMode, flag: "wx" });
      } catch (rollbackError) {
        rollbackErrors.push(`${candidate.path}: ${rollbackError.message}`);
      }
    }
    return { deleted: [], errors: [`Retirement ledger update failed and attempted rollback: ${error.message}`, ...rollbackErrors] };
  }
  return { deleted: candidates.map(candidate => candidate.path), errors: [] };
}

export function listScenarioCheckpointIds(scenario, rules) {
  return [...checkpointMap(rules, scenario).keys()];
}

function parseOptions(args) {
  if (args[0] === "--") args = args.slice(1);
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!key.startsWith("--") || Object.hasOwn(options, key)) throw new Error(`Invalid or repeated option: ${key}`);
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Expected a value after ${key}`);
    options[key] = value;
  }
  return options;
}

function parseUuidList(value) {
  if (!value) return [];
  const ids = value.split(",");
  if (ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("Run IDs must be comma-separated UUIDs");
  }
  return ids;
}

function reportsRoot(root) {
  return join(root, "frontend/test-results/agent-testing");
}

function pathsForRunIds(root, runIds) {
  return runIds.map(id => join(reportsRoot(root), id, "report.json"));
}

async function main(args) {
  const [command, ...rest] = args;
  const options = parseOptions(rest);
  const root = resolve(options["--root"] ?? repositoryRoot);
  const ids = parseUuidList(options["--run-ids"]);
  const reportPaths = pathsForRunIds(root, ids);
  if (options["--root"] && !isAbsolute(options["--root"])) throw new Error("--root must be absolute");

  if (command === "record") {
    const runId = options["--run-id"];
    if (!runId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) throw new Error("--run-id must be a UUID");
    const evidence = options["--evidence"] ? options["--evidence"].split(",") : [];
    const reportPath = join(reportsRoot(root), runId, "report.json");
    const report = await recordScenarioCheckpoint(reportPath, {
      checkpointId: options["--checkpoint"],
      status: options["--status"],
      observed: options["--observed"],
      evidence
    }, root);
    process.stdout.write(`${JSON.stringify({ runId, scenario: report.scenario, checkpoint: options["--checkpoint"], status: options["--status"] })}\n`);
    return;
  }

  if (command === "verify") {
    const scenarios = options["--scenario"] ? [options["--scenario"]] : undefined;
    const result = await verifyReportSet({ reportPaths, scenarios, root });
    process.stdout.write(`${JSON.stringify({
      valid: result.valid,
      errors: result.errors,
      reports: result.reports,
      managementDrift: result.managementDrift,
      ledgerDrift: result.ledgerDrift,
      productInputSha256: result.currentSummary.productInputSha256
    }, null, 2)}\n`);
    if (!result.valid) process.exitCode = 1;
    return;
  }

  if (command === "retire") {
    if (!options["--batch"]) throw new Error("--batch is required");
    const result = await retireBatch({ batchName: options["--batch"], reportPaths, root });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.errors.length) process.exitCode = 1;
    return;
  }

  throw new Error("Usage: node scripts/test-architecture.mjs <record|verify|retire> --run-id|--run-ids ...");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
