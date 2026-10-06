import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const journalRelativePath = ".template/init-journal.json";
const backupDirectoryPrefix = ".template/.init-backup-";

function isWithinRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function writeFileAtomically(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function runDockerReadOnly(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Cannot verify Supabase containers or volumes with Docker (${result.error?.message ?? `exit ${result.status ?? 1}`}). Refusing project initialization.`);
  }
  return result.stdout ?? "";
}

function resourceBelongsToProject(resourceName, projectId) {
  const escaped = projectId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(resourceName);
}

export async function assertNoSupabaseRuntimeState({
  projectRoot,
  projectIds,
  dockerRead = runDockerReadOnly
}) {
  for (const relativePath of ["supabase/.temp", "supabase/.branches"]) {
    try {
      await access(join(projectRoot, relativePath));
      throw new Error(`Local Supabase state exists at ${relativePath}. Refusing to change project identity or migration track.`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const [containers, volumes] = await Promise.all([
    dockerRead(["ps", "-a", "--format", "{{.Names}}"]),
    dockerRead(["volume", "ls", "--format", "{{.Name}}"])
  ]);
  const ids = [...new Set(projectIds.filter(Boolean))];
  const matches = resources => resources
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .filter(name => ids.some(id => resourceBelongsToProject(name, id)));
  const existingContainers = matches(containers);
  const existingVolumes = matches(volumes);
  if (existingContainers.length || existingVolumes.length) {
    throw new Error(
      `Supabase state already exists for this project (containers: ${existingContainers.join(", ") || "none"}; volumes: ${existingVolumes.join(", ") || "none"}). Refusing initialization.`
    );
  }
}

async function readJournal(projectRoot) {
  const journalPath = join(projectRoot, journalRelativePath);
  try {
    return JSON.parse(await readFile(journalPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Cannot read incomplete initialization journal ${journalRelativePath}: ${error instanceof Error ? error.message : "invalid journal"}`, { cause: error });
  }
}

export async function inspectProjectInitializationRecovery(projectRoot) {
  const journal = await readJournal(projectRoot);
  const templateDirectory = join(projectRoot, ".template");
  let entries = [];
  try {
    entries = await import("node:fs/promises").then(fs => fs.readdir(templateDirectory));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const backupDirectories = entries
    .filter(name => name.startsWith(backupDirectoryPrefix.split("/").at(-1)))
    .map(name => `.template/${name}`);
  return {
    journalPresent: Boolean(journal),
    backupDirectories,
    recoveryRequired: Boolean(journal) || backupDirectories.length > 0
  };
}

async function restoreJournal(projectRoot, journal, writeFileFn = writeFileAtomically) {
  if (journal?.schemaVersion !== 1 || !Array.isArray(journal.changes)) {
    throw new Error("Incomplete initialization journal is invalid; refusing to write project files.");
  }
  for (const change of [...journal.changes].reverse()) {
    const target = resolve(projectRoot, change.path);
    if (!isWithinRoot(projectRoot, target)) throw new Error("Initialization journal contains a path outside the project.");
    if (change.existed) await writeFileFn(target, change.originalContents);
    else await rm(target, { force: true });
  }
  await rm(join(projectRoot, journalRelativePath), { force: true });
}

export async function recoverProjectInitialization(projectRoot, options = {}) {
  const journal = await readJournal(projectRoot);
  if (journal) {
    await restoreJournal(projectRoot, journal, options.writeFile ?? writeFileAtomically);
  }
  const templateDirectory = join(projectRoot, ".template");
  let entries = [];
  try {
    entries = await import("node:fs/promises").then(fs => fs.readdir(templateDirectory));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await Promise.all(entries
    .filter(name => name.startsWith(backupDirectoryPrefix.split("/").at(-1)))
    .map(name => rm(join(templateDirectory, name), { recursive: true, force: true })));
}

export async function applyAtomicFileChanges(projectRoot, fileChanges, options = {}) {
  await recoverProjectInitialization(projectRoot, options);
  const changes = [];
  for (const [path, contents] of Object.entries(fileChanges)) {
    const target = resolve(projectRoot, path);
    if (!isWithinRoot(projectRoot, target)) throw new Error(`Refusing to write outside project: ${path}`);
    try {
      changes.push({ path, existed: true, originalContents: await readFile(target, "utf8"), contents });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      changes.push({ path, existed: false, originalContents: null, contents });
    }
  }

  const journalPath = join(projectRoot, journalRelativePath);
  const journal = { schemaVersion: 1, changes: changes.map(({ path, existed, originalContents }) => ({ path, existed, originalContents })) };
  await writeFileAtomically(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  const write = options.writeFile ?? writeFileAtomically;
  try {
    for (const change of changes) await write(join(projectRoot, change.path), change.contents);
    await rm(journalPath, { force: true });
  } catch (error) {
    try {
      await restoreJournal(projectRoot, journal, write);
    } catch (restoreError) {
      throw new Error(
        `Project initialization failed and rollback is incomplete (${restoreError instanceof Error ? restoreError.message : "rollback error"}). The recovery journal remains at ${journalRelativePath}.`,
        { cause: restoreError }
      );
    }
    throw error;
  }
}
