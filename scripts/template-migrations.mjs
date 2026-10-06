import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyAtomicFileChanges, assertNoSupabaseRuntimeState, recoverProjectInitialization } from "./template-bootstrap-helpers.mjs";

export const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const metadataRelativePath = "supabase/baselines/20261005084413/metadata.json";
const trackMarkerRelativePath = ".template/migration-track.json";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function migrationVersion(name) {
  const match = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
  if (!match) throw new Error(`Invalid migration filename: ${name}`);
  return match[1];
}

async function migrationFiles(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(".sql"))
    .map(entry => entry.name)
    .sort();
}

async function readBaseline(root) {
  const metadata = JSON.parse(await readFile(join(root, metadataRelativePath), "utf8"));
  if (metadata.schemaVersion !== 1 || !/^\d{14}$/.test(metadata.cutoff)) {
    throw new Error("Template migration baseline metadata is invalid.");
  }
  if (migrationVersion(metadata.migration.split("/").at(-1)) !== metadata.cutoff) {
    throw new Error("Baseline migration filename must match its immutable cutoff version.");
  }
  const migrationDirectory = join(root, dirname(metadataRelativePath), "migrations");
  const baselinePath = join(root, dirname(metadataRelativePath), metadata.migration);
  const baselineContents = await readFile(baselinePath);
  if (sha256(baselineContents) !== metadata.sha256) {
    throw new Error(`Published baseline ${metadata.cutoff} was modified; publish a new baseline version instead.`);
  }
  return { metadata, migrationDirectory, baselinePath, baselineContents };
}

async function writeAtomically(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Mirror only migrations after the immutable baseline cutoff. Existing content is never overwritten. */
export async function syncBaselineMigrations(root = projectRoot) {
  const { metadata, migrationDirectory } = await readBaseline(root);
  const historyDirectory = join(root, "supabase/migrations");
  const historyFiles = await migrationFiles(historyDirectory);
  const cutoffFile = historyFiles.find(file => migrationVersion(file) === metadata.cutoff);
  if (!cutoffFile) throw new Error(`Historical migrations do not contain baseline cutoff ${metadata.cutoff}.`);
  const laterFiles = historyFiles.filter(file => migrationVersion(file) > metadata.cutoff);
  const baselineFiles = await migrationFiles(migrationDirectory);
  const baselineLaterFiles = baselineFiles.filter(file => migrationVersion(file) > metadata.cutoff);
  const unexpectedBaselineFiles = baselineLaterFiles.filter(file => !laterFiles.includes(file));
  if (unexpectedBaselineFiles.length) {
    throw new Error(`Baseline track contains migrations absent from history: ${unexpectedBaselineFiles.join(", ")}`);
  }

  const copied = [];
  for (const file of laterFiles) {
    const source = await readFile(join(historyDirectory, file));
    const targetPath = join(migrationDirectory, file);
    try {
      const current = await readFile(targetPath);
      if (sha256(current) !== sha256(source)) {
        throw new Error(`Shared incremental migration ${file} differs between tracks; do not edit a published migration.`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await writeAtomically(targetPath, source);
      copied.push(file);
    }
  }
  return { cutoff: metadata.cutoff, copied, incrementals: laterFiles };
}

async function readTrackMarker(root) {
  try {
    return JSON.parse(await readFile(join(root, trackMarkerRelativePath), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read migration track marker: ${error instanceof Error ? error.message : "invalid marker"}`, { cause: error });
  }
}

async function currentProjectId(root) {
  const config = await readFile(join(root, "supabase/config.toml"), "utf8");
  const matches = [...config.matchAll(/^project_id\s*=\s*"([^"]+)"\s*$/gm)];
  if (matches.length !== 1) throw new Error("Cannot determine the current Supabase project_id.");
  return matches[0][1];
}

async function materializeBaseline(root, baselineDirectory, metadata) {
  const active = join(root, "supabase/migrations");
  const archive = join(root, ".template/migration-history", `history-through-${metadata.cutoff}`);
  const staged = join(root, ".template", `.migration-stage-${randomUUID()}`);
  try {
    await readdir(archive);
    throw new Error(`Legacy migrations are already archived at ${archive}.`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(staged, { recursive: true });
  let archivedHistory = false;
  let activeBaseline = false;
  try {
    for (const file of await migrationFiles(baselineDirectory)) {
      await copyFile(join(baselineDirectory, file), join(staged, file));
    }
    await mkdir(dirname(archive), { recursive: true });
    await rename(active, archive);
    archivedHistory = true;
    await rename(staged, active);
    activeBaseline = true;
    await applyAtomicFileChanges(root, {
      [trackMarkerRelativePath]: `${JSON.stringify({
        schemaVersion: 1,
        track: "baseline",
        baselineVersion: metadata.cutoff
      }, null, 2)}\n`
    });
  } catch (error) {
    if (activeBaseline) await rm(active, { recursive: true, force: true });
    if (archivedHistory) await rename(archive, active);
    throw error;
  } finally {
    await rm(staged, { recursive: true, force: true });
  }
}

export async function selectMigrationTrack({
  root = projectRoot,
  track,
  dockerRead
}) {
  if (track !== "history" && track !== "baseline") {
    throw new Error("Migration track must be 'history' or 'baseline'.");
  }
  await recoverProjectInitialization(root);
  const marker = await readTrackMarker(root);
  if (marker) {
    if (marker.track !== track) {
      throw new Error(`This checkout is already on the ${marker.track} migration track; migration tracks are immutable.`);
    }
    if (track === "baseline") return { status: "selected", ...(await syncSelectedBaselineTrack(root, marker)) };
    return { status: "already-selected", track };
  }

  const projectId = await currentProjectId(root);
  const projectMarkerPath = join(root, ".template/project.json");
  let initializedProject = null;
  try {
    initializedProject = JSON.parse(await readFile(projectMarkerPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (projectId !== "fullstack-admin-template" && initializedProject?.projectId !== projectId) {
    throw new Error("A custom Supabase project ID requires a matching first-initialization marker before selecting migrations.");
  }

  await assertNoSupabaseRuntimeState({
    projectRoot: root,
    projectIds: [projectId],
    ...(dockerRead ? { dockerRead } : {})
  });
  if (track === "history") {
    await applyAtomicFileChanges(root, {
      [trackMarkerRelativePath]: `${JSON.stringify({ schemaVersion: 1, track: "history" }, null, 2)}\n`
    });
    return { status: "selected", track };
  }

  const { metadata, migrationDirectory } = await readBaseline(root);
  const sync = await syncBaselineMigrations(root);
  await materializeBaseline(root, migrationDirectory, metadata);
  return { status: "selected", track, cutoff: metadata.cutoff, copied: sync.copied };
}

async function syncSelectedBaselineTrack(root, marker) {
  const { metadata, migrationDirectory } = await readBaseline(root);
  if (marker.baselineVersion !== metadata.cutoff) {
    throw new Error("Selected baseline version differs from the published baseline marker.");
  }
  const active = join(root, "supabase/migrations");
  const activeFiles = await migrationFiles(active);
  const legacyFiles = activeFiles.filter(file => migrationVersion(file) < metadata.cutoff);
  if (legacyFiles.length) {
    throw new Error(`Legacy history was reintroduced into the baseline track: ${legacyFiles.join(", ")}. Remove those active files before syncing.`);
  }
  const copied = [];
  for (const file of await migrationFiles(migrationDirectory)) {
    const source = await readFile(join(migrationDirectory, file));
    const target = join(active, file);
    try {
      const current = await readFile(target);
      if (sha256(current) !== sha256(source)) {
        throw new Error(`Active migration ${file} differs from the published baseline track.`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await writeAtomically(target, source);
      copied.push(file);
    }
  }
  return { track: "baseline", cutoff: metadata.cutoff, copied };
}

function parseArguments(args) {
  const [action, ...rest] = args.filter(argument => argument !== "--");
  if (action === "sync") return { action };
  if (action !== "select" || rest.length !== 2 || rest[0] !== "--track") {
    throw new Error("Usage: pnpm template:select-migrations -- --track <history|baseline> | pnpm template:sync-migrations");
  }
  return { action, track: rest[1] };
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.action === "sync") {
    const marker = await readTrackMarker(projectRoot);
    const result = marker?.track === "baseline"
      ? await syncSelectedBaselineTrack(projectRoot, marker)
      : marker?.track === "history"
        ? { copied: [] }
        : await syncBaselineMigrations(projectRoot);
    console.log(`Migration sync complete: ${result.copied.length} shared incrementals copied.`);
    return;
  }
  const result = await selectMigrationTrack({ root: projectRoot, track: parsed.track });
  console.log(`Migration track ${result.track} selected${result.cutoff ? ` at ${result.cutoff}` : ""}.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Migration track selection failed");
    process.exitCode = 1;
  });
}
