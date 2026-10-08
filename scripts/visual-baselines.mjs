import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { repositoryRoot, summarizeInputs, summarizeSnapshotInputs } from "./test-architecture.mjs";

const manifestRelativePath = "visual/test-manifest.json";
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const digest = value => createHash("sha256").update(value).digest("hex");
const candidateIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeBaselinePath(path) {
  return typeof path === "string" && path.startsWith("frontend/e2e/") && path.includes("-snapshots/") &&
    path.endsWith(".png") && !path.split("/").some(part => part === ".." || part === "." || part === "");
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

async function readManifest(root) {
  const bytes = await readFile(join(root, manifestRelativePath));
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.states) || manifest.states.length !== 14) {
    throw new Error("Visual manifest must define exactly 14 versioned pixel states");
  }
  const ids = manifest.states.map(state => state.id);
  const paths = manifest.states.map(state => state.baseline);
  if (new Set(ids).size !== ids.length || new Set(paths).size !== paths.length) {
    throw new Error("Visual state IDs and baseline paths must be unique");
  }
  for (const state of manifest.states) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(state.id) || !state.testTitle || !state.screenshot || !safeBaselinePath(state.baseline)) {
      throw new Error("Visual manifest contains an invalid state entry");
    }
  }
  if (!Array.isArray(manifest.baselineAdditions) || !Array.isArray(manifest.baselineDeletions)) {
    throw new Error("Visual baseline additions and deletions must be explicitly registered arrays");
  }
  if (manifest.baselineAdditions.some(path => !paths.includes(path) || !safeBaselinePath(path))) {
    throw new Error("Every registered baseline addition must name an active visual state");
  }
  if (new Set(manifest.baselineAdditions).size !== manifest.baselineAdditions.length ||
      manifest.baselineDeletions.some(entry => paths.includes(entry.path)) ||
      new Set(manifest.baselineDeletions.map(entry => entry.path)).size !== manifest.baselineDeletions.length) {
    throw new Error("Baseline add/delete registrations must be unique and cannot overlap active states");
  }
  if (manifest.baselineDeletions.some(entry => !entry || !safeBaselinePath(entry.path) || !/^[0-9a-f]{64}$/.test(entry.sha256))) {
    throw new Error("Baseline deletions must include a safe path and the reviewed original SHA-256");
  }
  return { manifest, bytes };
}

async function listPngs(directory) {
  const output = [];
  async function walk(current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); }
    catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".png")) output.push(path);
      else if (entry.isSymbolicLink()) throw new Error(`Visual inventory does not accept symlinks: ${path}`);
    }
  }
  await walk(directory);
  return output.sort();
}

async function pngHash(path) {
  const bytes = await readFile(path);
  if (!bytes.subarray(0, 8).equals(pngSignature)) throw new Error(`Invalid PNG file: ${path}`);
  return { bytes, sha256: digest(bytes) };
}

async function currentBaselineInventory(root, manifest) {
  const directory = join(root, "frontend/e2e");
  const files = await listPngs(directory);
  const inventory = new Map();
  for (const file of files) {
    const path = file.slice(root.length + 1).split(sep).join("/");
    if (!path.includes("-snapshots/")) continue;
    inventory.set(path, (await pngHash(file)).sha256);
  }
  const registered = new Set([
    ...manifest.states.map(state => state.baseline),
    ...manifest.baselineDeletions.map(entry => entry.path)
  ]);
  for (const path of registered) {
    const target = join(root, ...path.split("/"));
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Formal visual baseline target must be a regular file: ${path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const unexpected = [...inventory.keys()].filter(path => !registered.has(path));
  if (unexpected.length) throw new Error(`Formal visual baselines are unregistered: ${unexpected.join(", ")}`);
  for (const path of manifest.baselineDeletions.map(entry => entry.path)) {
    if (!inventory.has(path)) throw new Error(`Registered visual baseline deletion is missing: ${path}`);
  }
  return inventory;
}

export async function assertVisualBaselinesComplete(root = repositoryRoot) {
  const { manifest } = await readManifest(root);
  if (manifest.baselineAdditions.length || manifest.baselineDeletions.length) {
    throw new Error("Visual baseline additions or deletions still need explicit candidate acceptance");
  }
  const inventory = await currentBaselineInventory(root, manifest);
  const expected = new Set(manifest.states.map(state => state.baseline));
  const missing = [...expected].filter(path => !inventory.has(path));
  const extra = [...inventory.keys()].filter(path => !expected.has(path));
  if (missing.length || extra.length) {
    throw new Error(`Formal visual baseline inventory is incomplete (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`);
  }
  return { stateCount: manifest.states.length, baselineCount: inventory.size };
}

async function findDiagnosticImages(root) {
  return await listPngs(root);
}

export async function createVisualCandidate({
  root = repositoryRoot,
  workspaceRoot,
  diagnosticsRoot,
  startingSummary,
  candidateId = randomUUID()
}) {
  if (!candidateIdPattern.test(candidateId)) throw new Error("Candidate ID must be a UUID");
  const sourceRoot = resolve(root);
  const workspace = resolve(workspaceRoot);
  const candidateRoot = join(sourceRoot, "visual/candidates", candidateId);
  try {
    await lstat(candidateRoot);
    throw new Error(`Visual candidate already exists: ${candidateId}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const { manifest } = await readManifest(sourceRoot);
  const finalSummary = await summarizeInputs(sourceRoot, "visual");
  const snapshotSummary = await summarizeSnapshotInputs(workspace, "visual", startingSummary);
  if (!startingSummary || startingSummary.inputSha256 !== finalSummary.inputSha256 ||
      startingSummary.rulesSha256 !== finalSummary.rulesSha256 ||
      startingSummary.inputSha256 !== snapshotSummary.inputSha256 ||
      startingSummary.rulesSha256 !== snapshotSummary.rulesSha256) {
    throw new Error("Visual worktree or fixed snapshot inputs changed during candidate generation");
  }

  const formalInventory = await currentBaselineInventory(sourceRoot, manifest);
  const diagnosticFiles = diagnosticsRoot ? await findDiagnosticImages(resolve(diagnosticsRoot)) : [];
  const expectedStates = new Set(manifest.states.map(state => state.baseline));
  const pendingDeletionPaths = new Set(manifest.baselineDeletions.map(entry => entry.path));
  const expectedFormal = new Set([...expectedStates, ...pendingDeletionPaths]);
  for (const path of formalInventory.keys()) if (!expectedFormal.has(path)) throw new Error(`Unregistered formal baseline exists: ${path}`);
  const additions = new Set(manifest.baselineAdditions);
  const states = [];

  for (const state of manifest.states) {
    const originalSha256 = formalInventory.get(state.baseline) ?? null;
    if (originalSha256 === null && !additions.has(state.baseline)) {
      throw new Error(`New visual baseline is not explicitly registered: ${state.baseline}`);
    }
    if (originalSha256 !== null && additions.has(state.baseline)) {
      throw new Error(`Registered baseline addition already exists formally: ${state.baseline}`);
    }
    const candidatePath = join(workspace, ...state.baseline.split("/"));
    const candidate = await pngHash(candidatePath);
    const screenshotStem = state.screenshot.slice(0, -4);
    const hasPixelDiff = diagnosticFiles.some(path => basename(path).includes(screenshotStem) && basename(path).endsWith("-diff.png"));
    const operation = originalSha256 === null ? "add"
      : originalSha256 === candidate.sha256 || !hasPixelDiff ? "unchanged"
        : "update";
    states.push({
      id: state.id,
      screenshot: state.screenshot,
      baseline: state.baseline,
      operation,
      originalSha256,
      candidateSha256: candidate.sha256,
      candidateRelativePath: `candidates/${state.id}.png`,
      originalRelativePath: originalSha256 ? `original/${state.id}.png` : null
    });
  }

  for (const deletion of manifest.baselineDeletions) {
    if (formalInventory.get(deletion.path) !== deletion.sha256) {
      throw new Error(`Registered baseline deletion hash changed: ${deletion.path}`);
    }
    const deletionId = `delete-${digest(Buffer.from(deletion.path)).slice(0, 8)}-${basename(deletion.path, ".png")}`;
    states.push({
      id: deletionId,
      screenshot: null,
      baseline: deletion.path,
      operation: "delete",
      originalSha256: deletion.sha256,
      candidateSha256: null,
      candidateRelativePath: null,
      originalRelativePath: `original/${deletionId}.png`
    });
  }

  await mkdir(join(candidateRoot, "candidates"), { recursive: true });
  await mkdir(join(candidateRoot, "original"), { recursive: true });
  const stateIndex = [];
  for (const [index, state] of states.entries()) {
    if (state.operation !== "delete") {
      await cp(join(workspace, ...state.baseline.split("/")), join(candidateRoot, state.candidateRelativePath));
    }
    if (state.originalSha256) {
      await cp(join(sourceRoot, ...state.baseline.split("/")), join(candidateRoot, state.originalRelativePath));
    }
    stateIndex.push({ ...state, index });
  }

  const diagnostics = [];
  for (const [index, path] of diagnosticFiles.entries()) {
    const relativePath = path.slice(resolve(diagnosticsRoot).length + 1).split(sep).join("/");
    const destination = join(candidateRoot, "diagnostics", relativePath);
    await mkdir(dirname(destination), { recursive: true });
    await cp(path, destination);
    diagnostics.push({ path: `diagnostics/${relativePath}`, sha256: (await pngHash(destination)).sha256, index });
  }

  for (const state of states.filter(entry => entry.operation === "update")) {
    const stem = state.screenshot.slice(0, -4);
    for (const suffix of ["-expected.png", "-diff.png"]) {
      if (!diagnostics.some(file => basename(file.path).includes(stem) && basename(file.path).endsWith(suffix))) {
        throw new Error(`Changed state ${state.id} is missing its ${suffix.slice(1, -4)} image for review`);
      }
    }
  }

  const record = {
    schemaVersion: 1,
    candidateId,
    createdAt: new Date().toISOString(),
    rulesVersion: startingSummary.rulesVersion,
    rulesSha256: startingSummary.rulesSha256,
    inputSha256: startingSummary.inputSha256,
    stateCount: manifest.states.length,
    states,
    diagnostics
  };
  const reviewStates = states.map(state => {
    const screenshotStem = state.screenshot?.replace(/\.png$/, "");
    const diagnosticPath = suffix => diagnostics.find(file =>
      screenshotStem && basename(file.path).includes(screenshotStem) && basename(file.path).endsWith(suffix)
    )?.path;
    const candidateImage = state.candidateRelativePath
      ? `<figure><figcaption>Candidate</figcaption><img src="${escapeHtml(state.candidateRelativePath)}" alt="${escapeHtml(state.id)} candidate"></figure>`
      : "";
    const originalImage = state.originalRelativePath
      ? `<figure><figcaption>Original formal baseline</figcaption><img src="${escapeHtml(state.originalRelativePath)}" alt="${escapeHtml(state.id)} original"></figure>`
      : "";
    const expectedPath = diagnosticPath("-expected.png");
    const diffPath = diagnosticPath("-diff.png");
    const diagnosticImages = [expectedPath, diffPath].filter(Boolean).map((path, index) =>
      `<figure><figcaption>${index === 0 ? "Playwright expected" : "Pixel diff"}</figcaption><img src="${escapeHtml(path)}" alt="${escapeHtml(state.id)} diagnostic"></figure>`
    ).join("");
    return `<section><h2>${escapeHtml(state.id)} · ${escapeHtml(state.operation)}</h2><p><code>${escapeHtml(state.baseline)}</code></p><div class="images">${originalImage}${candidateImage}${diagnosticImages}</div></section>`;
  }).join("\n");
  const reviewPath = join(candidateRoot, "review.html");
  await writeFile(reviewPath, `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'">
<title>Visual candidate ${candidateId}</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#18212f}h1{margin-bottom:6px}p.meta{color:#566273}section{margin:28px 0;padding:16px;border:1px solid #ccd3dd;border-radius:10px}section h2{font-size:18px}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px}figure{margin:0}figcaption{font-weight:600;margin:0 0 6px}img{display:block;width:100%;height:auto;border:1px solid #ccd3dd}code{overflow-wrap:anywhere}</style>
<h1>Visual candidate ${candidateId}</h1><p class="meta">Review candidates against formal baselines and inspect each diff before acceptance. Operations: ${JSON.stringify(states.reduce((counts,state)=>(counts[state.operation]=(counts[state.operation]??0)+1,counts),{}))}</p>
${reviewStates}</html>
`, { mode: 0o600 });
  record.reviewFile = "review.html";
  record.reviewFileSha256 = digest(await readFile(reviewPath));
  await writeFile(join(candidateRoot, "candidate.json"), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { candidateId, path: candidateRoot, record };
}

async function atomicWrite(path, bytes, mode = 0o644) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes, { mode });
  await rename(temporary, path);
}

export async function acceptVisualCandidate({ root = repositoryRoot, candidateId, operations = {} }) {
  if (!candidateIdPattern.test(candidateId ?? "")) throw new Error("--candidate must be a UUID");
  const absoluteRoot = resolve(root);
  const candidateRoot = join(absoluteRoot, "visual/candidates", candidateId);
  const candidate = JSON.parse(await readFile(join(candidateRoot, "candidate.json"), "utf8"));
  if (candidate.schemaVersion !== 1 || candidate.candidateId !== candidateId || candidate.stateCount !== 14) {
    throw new Error("Visual candidate manifest is invalid or incomplete");
  }
  if (candidate.reviewFile !== "review.html" || digest(await readFile(join(candidateRoot, candidate.reviewFile))) !== candidate.reviewFileSha256) {
    throw new Error("Visual candidate review page is missing or changed after it was generated");
  }
  const currentSummary = await summarizeInputs(absoluteRoot, "visual");
  if (candidate.inputSha256 !== currentSummary.inputSha256 || candidate.rulesSha256 !== currentSummary.rulesSha256 ||
      candidate.rulesVersion !== currentSummary.rulesVersion) {
    throw new Error("Visual candidate is stale because source inputs or rules changed");
  }
  const { manifest, bytes: originalManifestBytes } = await readManifest(absoluteRoot);
  const activeStates = new Map(manifest.states.map(state => [state.baseline, state.id]));
  if (candidate.states.filter(state => state.operation !== "delete").length !== manifest.states.length ||
      candidate.states.filter(state => state.operation === "delete").length !== manifest.baselineDeletions.length) {
    throw new Error("Visual candidate does not contain the complete current baseline state set");
  }
  const currentInventory = await currentBaselineInventory(absoluteRoot, manifest);
  const changes = candidate.states.filter(state => state.operation !== "unchanged");
  if (changes.length === 0) throw new Error("Visual candidate contains no baseline changes to accept");
  const manifestStates = new Set(manifest.states.map(state => state.baseline));
  const additions = new Set(manifest.baselineAdditions);
  const deletions = new Map(manifest.baselineDeletions.map(entry => [entry.path, entry.sha256]));

  for (const state of candidate.states) {
    if (state.operation === "delete") {
      if (!safeBaselinePath(state.baseline) || state.candidateRelativePath !== null) throw new Error("Candidate contains an invalid deletion entry");
      if (deletions.get(state.baseline) !== state.originalSha256 || currentInventory.get(state.baseline) !== state.originalSha256) {
        throw new Error(`Visual candidate deletion was not registered against the current original: ${state.baseline}`);
      }
      const original = await pngHash(join(candidateRoot, `original/${state.id}.png`));
      if (original.sha256 !== state.originalSha256) throw new Error(`Candidate original baseline hash does not match: ${state.baseline}`);
      continue;
    }
    if (!manifestStates.has(state.baseline) || activeStates.get(state.baseline) !== state.id ||
        state.candidateRelativePath !== `candidates/${state.id}.png`) {
      throw new Error(`Visual candidate target is absent or mismatched in the state manifest: ${state.baseline}`);
    }
    const currentSha256 = currentInventory.get(state.baseline) ?? null;
    if (currentSha256 !== state.originalSha256) throw new Error(`Formal baseline changed since candidate generation: ${state.baseline}`);
    if (state.operation === "add" && !additions.has(state.baseline)) throw new Error(`Baseline addition is no longer registered: ${state.baseline}`);
    if (state.operation === "update" && currentSha256 === null) throw new Error(`Visual update target disappeared: ${state.baseline}`);
    if (!safeBaselinePath(state.baseline) || !state.candidateRelativePath) throw new Error("Candidate contains an invalid baseline target");
    const candidateFile = join(candidateRoot, state.candidateRelativePath);
    const image = await pngHash(candidateFile);
    if (image.sha256 !== state.candidateSha256) throw new Error(`Candidate PNG hash does not match its manifest: ${state.baseline}`);
    if (state.originalSha256 !== null) {
      if (state.originalRelativePath !== `original/${state.id}.png`) throw new Error("Candidate original reference is invalid");
      const original = await pngHash(join(candidateRoot, state.originalRelativePath));
      if (original.sha256 !== state.originalSha256) throw new Error(`Candidate original baseline hash does not match: ${state.baseline}`);
    }
  }
  for (const file of candidate.diagnostics ?? []) {
    if (typeof file.path !== "string" || !file.path.startsWith("diagnostics/") || file.path.split("/").includes("..")) {
      throw new Error("Visual candidate contains an invalid diagnostic reference");
    }
    if ((await pngHash(join(candidateRoot, ...file.path.split("/")))).sha256 !== file.sha256) {
      throw new Error(`Visual diagnostic hash does not match: ${file.path}`);
    }
  }
  for (const deletion of manifest.baselineDeletions) {
    if (!candidate.states.some(state => state.operation === "delete" && state.baseline === deletion.path)) {
      throw new Error(`Explicit baseline deletion is missing from the candidate: ${deletion.path}`);
    }
  }

  const backups = new Map();
  for (const state of changes) {
    const target = join(absoluteRoot, ...state.baseline.split("/"));
    backups.set(target, state.operation === "add"
      ? { bytes: null, mode: 0o644 }
      : { bytes: await readFile(target), mode: (await lstat(target)).mode & 0o777 });
  }
  const manifestPath = join(absoluteRoot, manifestRelativePath);
  const removedAdditions = new Set(changes.filter(state => state.operation === "add").map(state => state.baseline));
  const removedDeletions = new Set(changes.filter(state => state.operation === "delete").map(state => state.baseline));
  const updatedManifest = {
    ...manifest,
    baselineAdditions: manifest.baselineAdditions.filter(path => !removedAdditions.has(path)),
    baselineDeletions: manifest.baselineDeletions.filter(entry => !removedDeletions.has(entry.path))
  };

  try {
    for (const state of changes) {
      const target = join(absoluteRoot, ...state.baseline.split("/"));
      if (state.operation === "delete") await (operations.remove ?? rm)(target);
      else await (operations.atomicWrite ?? atomicWrite)(target, await readFile(join(candidateRoot, state.candidateRelativePath)), backups.get(target)?.mode ?? 0o644);
    }
    await atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(updatedManifest, null, 2)}\n`));
    await assertVisualBaselinesComplete(absoluteRoot);
  } catch (error) {
    const rollbackFailures = [];
    for (const [path, backup] of backups) {
      try {
        if (backup.bytes === null) await rm(path, { force: true });
        else await atomicWrite(path, backup.bytes, backup.mode);
      } catch (rollbackError) { rollbackFailures.push(`${path}: ${rollbackError.message}`); }
    }
    try { await atomicWrite(manifestPath, originalManifestBytes); }
    catch (rollbackError) { rollbackFailures.push(`${manifestPath}: ${rollbackError.message}`); }
    throw new Error(`Visual acceptance failed; rollback was attempted${rollbackFailures.length ? ` and had errors: ${rollbackFailures.join("; ")}` : ""}: ${error.message}`, { cause: error });
  }
  return { candidateId, accepted: changes.map(state => ({ path: state.baseline, operation: state.operation })) };
}
