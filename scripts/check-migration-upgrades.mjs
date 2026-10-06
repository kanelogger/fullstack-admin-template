import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { captureBaseline, createIsolatedProject, projectRoot, reservePorts } from "./check-migrations.mjs";

const fixtureDirectory = join(projectRoot, "scripts/fixtures");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const docker = process.platform === "win32" ? "docker.exe" : "docker";

export async function withUpgradeWorkspace(tempRoot, operation, options = {}) {
  let preserveWorkspace = false;
  try {
    return await operation(() => {
      preserveWorkspace = true;
    });
  } finally {
    if (preserveWorkspace) {
      (options.onRetain ?? (path => console.error(`Retained migration upgrade diagnostics at ${path}`)))(tempRoot);
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

function run(args, { cwd = projectRoot, env = {}, input } = {}) {
  const result = spawnSync(pnpm, args, {
    cwd,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: { ...process.env, ...env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  if (result.error || result.status !== 0) {
    const details = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .replace(/(service[_ -]?role[_ -]?key|secret[_ -]?key)(\s*[:=]\s*)[^\s"']+/gi, "$1$2[REDACTED]")
      .replace(/\bsb_secret_[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(/\beyJ[a-zA-Z0-9_.-]{24,}/g, "[REDACTED]")
      .replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1[REDACTED]@");
    throw new Error(`Command failed (${args.slice(-3).join(" ")}; ${result.error?.message ?? `exit ${result.status ?? 1}`})${details.trim() ? `\n${details.trim().slice(-2500)}` : ""}`);
  }
  return result.stdout ?? "";
}

function runPsql(projectId, sql) {
  const result = spawnSync(docker, [
    "exec", "-i", `supabase_db_${projectId}`, "psql",
    "-v", "ON_ERROR_STOP=1", "-At", "-U", "postgres", "-d", "postgres"
  ], {
    cwd: projectRoot,
    input: sql,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Disposable database query failed (${result.error?.message ?? `exit ${result.status ?? 1}`}): ${(result.stderr ?? "").trim().slice(-1600)}`);
  }
  return (result.stdout ?? "").trim();
}

async function migrationFiles(directory) {
  return (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
}

async function replaceMigrations(targetRoot, names, sourceDirectory) {
  const target = join(targetRoot, "supabase/migrations");
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const name of names) await cp(join(sourceDirectory, name), join(target, name));
}

async function validateLedger(projectId, expectedVersions) {
  const output = runPsql(projectId, "select version from supabase_migrations.schema_migrations order by version;");
  const actual = output ? output.split(/\r?\n/) : [];
  assert.deepEqual(actual, expectedVersions, `Migration ledger for ${projectId} does not match its track.`);
}

function manifestEntryKey(entry) {
  if (entry.code) return entry.code;
  if (entry.role && entry.permission_key) return `${entry.role}.${entry.permission_key}`;
  if (entry.permission_key) return entry.permission_key;
  if (entry.schema && entry.table && entry.name) return `${entry.schema}.${entry.table}.${entry.name}`;
  if (entry.schema && entry.table && entry.position) return `${entry.schema}.${entry.table}.${entry.name}`;
  if (entry.schema && entry.name && entry.identity_arguments !== undefined) return `${entry.schema}.${entry.name}(${entry.identity_arguments})`;
  if (entry.schema && entry.name) return `${entry.schema}.${entry.name}`;
  if (entry.publication) return `${entry.publication}.${entry.schema}.${entry.table}`;
  return JSON.stringify(entry);
}

function manifestDifference(history, baseline) {
  const summaries = [];
  for (const category of Object.keys(history)) {
    const left = history[category];
    const right = baseline[category];
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    if (Array.isArray(left) && Array.isArray(right)) {
      const rightByKey = new Map(right.map(entry => [manifestEntryKey(entry), entry]));
      const leftByKey = new Map(left.map(entry => [manifestEntryKey(entry), entry]));
      const missing = [...leftByKey.keys()].filter(key => !rightByKey.has(key));
      const extra = [...rightByKey.keys()].filter(key => !leftByKey.has(key));
      const changed = [...leftByKey.keys()].filter(key => rightByKey.has(key) && JSON.stringify(leftByKey.get(key)) !== JSON.stringify(rightByKey.get(key)));
      const detail = [];
      if (missing.length) detail.push(`history-only=${missing.slice(0, 3).join(",")}`);
      if (extra.length) detail.push(`baseline-only=${extra.slice(0, 3).join(",")}`);
      if (changed.length) {
        const key = changed[0];
        const leftEntry = leftByKey.get(key);
        const rightEntry = rightByKey.get(key);
        const fields = Object.keys(leftEntry).filter(field => JSON.stringify(leftEntry[field]) !== JSON.stringify(rightEntry[field]));
        const field = fields[0];
        detail.push(`changed=${key}[${field}] history=${JSON.stringify(leftEntry[field]).slice(0, 180)} baseline=${JSON.stringify(rightEntry[field]).slice(0, 180)}`);
      }
      summaries.push(`${category}{${detail.join("; ") || `counts ${left.length}/${right.length}`}}`);
    } else if (category === "seed") {
      const nested = Object.keys(left).filter(key => JSON.stringify(left[key]) !== JSON.stringify(right[key]));
      summaries.push(`seed{${nested.join(",")}}`);
    } else {
      summaries.push(category);
    }
  }
  return summaries;
}

function canonicalizeEquivalentConstraintRendering(manifest) {
  for (const constraint of manifest.constraints ?? []) {
    const check = constraint.definition.match(/^CHECK\((value_type::text)=ANY\(ARRAY\[(.*)\](?:::text\[\])?\)\)$/);
    if (!check) continue;
    const literals = [...check[2].matchAll(/'((?:[^']|'')*)'/g)].map(match => match[1].replaceAll("''", "'"));
    if (literals.length < 2) continue;
    literals.sort();
    constraint.definition = `CHECK(${check[1]}=ANY(ARRAY[${literals.map(value => `'${value.replaceAll("'", "''")}'`).join(",")}]::text[]))`;
  }
  return manifest;
}

async function createTrackDatabase(tempRoot, track, projectId, ports, initialMigrations, sourceDirectory) {
  const isolatedRoot = await createIsolatedProject(join(tempRoot, track), projectId, ports);
  await replaceMigrations(isolatedRoot, initialMigrations, sourceDirectory);
  return isolatedRoot;
}

async function upgradeTrack({
  track,
  projectId,
  ports,
  initialMigrations,
  sourceDirectory,
  laterSourceDirectory = sourceDirectory,
  laterMigrations,
  probeCode,
  tempRoot,
  baselineCandidatePath,
  retainWorkspace
}) {
  const isolatedRoot = await createTrackDatabase(tempRoot, track, projectId, ports, initialMigrations, sourceDirectory);
  const workdir = ["--filter", "fullstack-admin-frontend", "exec", "supabase", "--workdir", isolatedRoot];
  let stackMayExist = false;
  let trackResult;
  let operationError;
  try {
    stackMayExist = true;
    console.log(`Starting isolated ${track} track ${projectId}.`);
    run([...workdir, "start"]);
    // This reset creates the exact cutoff database. All upgrade assertions below
    // use migration up and retain this database and its inserted fixture data.
    run([...workdir, "db", "reset", "--local"]);
    if (baselineCandidatePath) await captureBaseline(workdir, isolatedRoot, baselineCandidatePath);
    await validateLedger(projectId, initialMigrations.map(name => name.slice(0, 14)));

    const probeSql = (await readFile(join(fixtureDirectory, "migration-upgrade-probe.sql"), "utf8"))
      .replaceAll("__UPGRADE_PROBE_CODE__", probeCode);
    runPsql(projectId, probeSql);
    const probeSnapshotSql = (await readFile(join(fixtureDirectory, "migration-upgrade-snapshot.sql"), "utf8"))
      .replaceAll("__UPGRADE_PROBE_CODE__", probeCode);
    const beforeUpgrade = JSON.parse(runPsql(projectId, probeSnapshotSql));
    assert.equal(beforeUpgrade.probe?.config_value, "must-survive-pending-migrations");
    assert.equal(beforeUpgrade.common_user_message_read, true);

    const activeMigrationDirectory = join(isolatedRoot, "supabase/migrations");
    for (const migration of laterMigrations) {
      await cp(join(laterSourceDirectory, migration), join(activeMigrationDirectory, migration));
    }
    console.log(`Applying ${laterMigrations.length} shared incremental migration(s) to ${track}.`);
    run([...workdir, "migration", "up", "--local"]);

    const expectedVersions = [...initialMigrations, ...laterMigrations]
      .map(name => name.slice(0, 14))
      .sort();
    await validateLedger(projectId, expectedVersions);
    const afterUpgrade = JSON.parse(runPsql(projectId, probeSnapshotSql));
    assert.deepEqual(afterUpgrade, beforeUpgrade, `Business data or authorization changed during ${track} upgrade.`);

    const localEnv = {
      SUPABASE_PROJECT_ROOT: isolatedRoot,
      E2E_MAILPIT_URL: `http://127.0.0.1:${ports.mailpit}`
    };
    run(["--filter", "fullstack-admin-frontend", "test:db"], { env: localEnv });

    const cleanupSql = (await readFile(join(fixtureDirectory, "migration-upgrade-cleanup.sql"), "utf8"))
      .replaceAll("__UPGRADE_PROBE_CODE__", probeCode);
    runPsql(projectId, cleanupSql);
    const probeCount = runPsql(projectId,
      `select count(*)::text from public.system_configs where config_code = '${probeCode}';`);
    assert.equal(probeCount, "0", `Upgrade probe data was not cleaned from ${track}.`);

    const legacyImporters = runPsql(projectId, `
      select count(*)::text
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where (namespace.nspname = 'public' and procedure.proname like 'import_legacy_%')
         or (namespace.nspname = 'public' and procedure.proname = 'assert_legacy_organization_references')
         or (namespace.nspname = 'app_private' and procedure.proname in (
           'assert_legacy_import_batch', 'parse_legacy_import_timestamp', 'resolve_legacy_actor_id'
         ));
    `);
    assert.equal(legacyImporters, "0", `Legacy importer functions remain in ${track}.`);
    const schemaManifest = runPsql(projectId, await readFile(join(fixtureDirectory, "migration-schema-manifest.sql"), "utf8"));
    trackResult = { schemaManifest, ledger: expectedVersions };
  } catch (error) {
    operationError = error;
  }

  let cleanupError;
  if (stackMayExist) {
    const stopped = spawnSync(pnpm, [...workdir, "stop", "--project-id", projectId, "--no-backup"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
    });
    if (stopped.error || stopped.status !== 0) {
      retainWorkspace();
      cleanupError = new Error(`Could not stop upgrade test stack ${projectId}; its workspace is ${isolatedRoot}`);
    }
  }
  if (operationError && cleanupError) {
    throw new AggregateError([operationError, cleanupError], "Migration upgrade validation failed and cleanup also failed.", { cause: operationError });
  }
  if (operationError) throw operationError;
  if (cleanupError) throw new Error(cleanupError.message, { cause: cleanupError });
  return trackResult;
}

async function main() {
  const metadata = JSON.parse(await readFile(join(projectRoot, "supabase/baselines/20261005084413/metadata.json"), "utf8"));
  const cutoffVersion = metadata.cutoff;
  assert.equal(cutoffVersion, "20261005084413", "The published migration baseline cutoff is immutable.");
  const historyDirectory = join(projectRoot, "supabase/migrations");
  const baselineDirectory = join(projectRoot, "supabase/baselines", cutoffVersion, "migrations");
  const historyFiles = await migrationFiles(historyDirectory);
  const baselineFiles = await migrationFiles(baselineDirectory);
  const publishedBaselineName = metadata.migration.split("/").at(-1);
  const publishedBaseline = await readFile(join(projectRoot, "supabase/baselines", cutoffVersion, metadata.migration));
  const baselineHash = createHash("sha256").update(publishedBaseline).digest("hex");
  assert.equal(baselineHash, metadata.sha256, "Published baseline content must remain immutable.");
  const historyVersions = historyFiles.map(name => name.slice(0, 14));
  const drillCutoff = historyVersions[Math.max(0, historyVersions.length - 4)];
  if (!drillCutoff || drillCutoff >= cutoffVersion) {
    throw new Error("A prior history version is required to exercise shared pending migration upgrades.");
  }
  const historyDrillInitial = historyFiles.filter(name => name.slice(0, 14) <= drillCutoff);
  const historyDrillLater = historyFiles.filter(name => name.slice(0, 14) > drillCutoff);
  const baselineInitial = baselineFiles.filter(name => name.slice(0, 14) <= cutoffVersion);
  const laterHistory = historyFiles.filter(name => name.slice(0, 14) > cutoffVersion);
  const laterBaseline = baselineFiles.filter(name => name.slice(0, 14) > cutoffVersion);
  assert.deepEqual(laterBaseline, laterHistory, "Both migration tracks must contain the same shared incrementals.");
  for (const migration of laterHistory) {
    assert.deepEqual(
      await readFile(join(historyDirectory, migration)),
      await readFile(join(baselineDirectory, migration)),
      `Shared incremental ${migration} differs between migration tracks.`
    );
  }
  assert.deepEqual(baselineInitial, [publishedBaselineName]);
  assert.ok(historyFiles.some(name => name.slice(0, 14) === cutoffVersion));

  const portsList = await reservePorts(9);
  const ports = {
    api: portsList[0], db: portsList[1], shadow: portsList[2], studio: portsList[3],
    mailpit: portsList[4], smtp: portsList[5], pop3: portsList[6],
    analytics: portsList[7], vector: portsList[8]
  };
  const tempRoot = await mkdtemp(join(os.tmpdir(), "fullstack-admin-upgrades-"));
  const probeCode = `template_upgrade_probe_${randomUUID().replaceAll("-", "")}`;
  const historyProjectId = `upg-hist-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const drillBaselineProjectId = `upg-drill-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const publishedBaselineProjectId = `upg-base-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  await withUpgradeWorkspace(tempRoot, async retainWorkspace => {
    const drillBaselineDirectory = join(tempRoot, "drill-baseline-migrations");
    await mkdir(drillBaselineDirectory, { recursive: true });
    const drillBaselineName = `${drillCutoff}_temporary_upgrade_baseline.sql`;
    const drillBaselinePath = join(drillBaselineDirectory, drillBaselineName);
    const history = await upgradeTrack({
      track: "history", projectId: historyProjectId, ports,
      initialMigrations: historyDrillInitial, sourceDirectory: historyDirectory,
      laterSourceDirectory: historyDirectory,
      laterMigrations: historyDrillLater, probeCode, tempRoot,
      baselineCandidatePath: drillBaselinePath, retainWorkspace
    });
    const drillBaseline = await upgradeTrack({
      track: "baseline-drill", projectId: drillBaselineProjectId, ports,
      initialMigrations: [drillBaselineName], sourceDirectory: drillBaselineDirectory,
      laterSourceDirectory: historyDirectory,
      laterMigrations: historyDrillLater, probeCode, tempRoot, retainWorkspace
    });
    const publishedBaseline = await upgradeTrack({
      track: "published-baseline", projectId: publishedBaselineProjectId, ports,
      initialMigrations: baselineInitial, sourceDirectory: baselineDirectory,
      laterSourceDirectory: baselineDirectory,
      laterMigrations: laterBaseline, probeCode, tempRoot, retainWorkspace
    });
    assert.deepEqual(history.ledger, historyVersions);
    assert.deepEqual(drillBaseline.ledger, [drillCutoff, ...historyDrillLater.map(name => name.slice(0, 14))].sort());
    assert.deepEqual(publishedBaseline.ledger, [cutoffVersion, ...laterBaseline.map(name => name.slice(0, 14))].sort());
    const historyManifest = canonicalizeEquivalentConstraintRendering(JSON.parse(history.schemaManifest));
    const drillManifest = canonicalizeEquivalentConstraintRendering(JSON.parse(drillBaseline.schemaManifest));
    const publishedManifest = canonicalizeEquivalentConstraintRendering(JSON.parse(publishedBaseline.schemaManifest));
    const manifestDiff = manifestDifference(historyManifest, drillManifest);
    if (manifestDiff.length) {
      throw new Error(`Historical and generated baseline upgrade tracks differ: ${manifestDiff.join("; ")}`);
    }
    const publishedDiff = manifestDifference(historyManifest, publishedManifest);
    if (publishedDiff.length) {
      throw new Error(`Historical and published baseline schema differ: ${publishedDiff.join("; ")}`);
    }
    console.log(`History and a generated baseline at ${drillCutoff} retained fixture data while applying ${historyDrillLater.length} real migrations to ${cutoffVersion}; the published baseline at ${cutoffVersion} also passed its pending-upgrade check (${laterBaseline.length} incrementals).`);
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Migration upgrade validation failed");
    process.exitCode = 1;
  });
}
