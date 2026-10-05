import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceSupabaseRoot = join(projectRoot, "supabase");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(args, { cwd = projectRoot, inherit = false, env = {} } = {}) {
  const result = spawnSync(pnpm, args, {
    cwd,
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: { ...process.env, ...env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  if (result.error || result.status !== 0) {
    const message = result.error?.message ?? `exit code ${result.status ?? 1}`;
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
      .replace(/(service[_ -]?role[_ -]?key|secret[_ -]?key)(\s*[:=]\s*)[^\s"']+/gi, "$1$2[REDACTED]")
      .replace(/\bsb_secret_[a-zA-Z0-9_-]+/g, "[REDACTED]")
      .replace(/\beyJ[a-zA-Z0-9_.-]{24,}/g, "[REDACTED]")
      .replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1[REDACTED]@");
    const safeTail = diagnostic.trim().slice(-3500);
    throw new Error(`${args.slice(-2).join(" ")} failed (${message})${safeTail ? `\n${safeTail}` : ""}`);
  }
  return result.stdout ?? "";
}

async function validateMigrationInventory() {
  const entries = (await readdir(join(sourceSupabaseRoot, "migrations")))
    .filter(name => name.endsWith(".sql"))
    .sort();
  assert.ok(entries.length > 0, "Supabase migrations must exist");
  const versions = entries.map(name => {
    const match = name.match(/^(\d{14})_[a-z0-9_]+\.sql$/);
    assert.ok(match, `Invalid migration filename: ${name}`);
    return match[1];
  });
  assert.equal(new Set(versions).size, versions.length, "Migration timestamps must be unique");
  assert.deepEqual(versions, [...versions].sort(), "Migration files must be ordered by timestamp");

  const seed = await readFile(join(sourceSupabaseRoot, "seed.sql"), "utf8");
  assert.equal((seed.match(/insert into public\.menus\s*\(/gi) ?? []).length, 1, "seed must define the default menu tree once");
  assert.doesNotMatch(seed, /import_legacy_/i, "seed must be independent from historical data import");
  console.log(`Checked ${entries.length} migration files and the repeatable seed layout.`);
}

async function reservePorts(count) {
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = net.createServer();
      await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListen);
      });
      servers.push(server);
    }
    return servers.map(server => server.address().port);
  } finally {
    await Promise.all(servers.map(server => new Promise(resolveClose => server.close(resolveClose))));
  }
}

function replacePort(config, section, property, value) {
  const lines = config.split("\n");
  let inSection = false;
  let replaced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) inSection = header[1] === section;
    if (inSection && new RegExp(`^\\s*${property}\\s*=`).test(line)) {
      lines[index] = `${property} = ${value}`;
      replaced = true;
      break;
    }
  }
  if (!replaced) throw new Error(`Could not find [${section}].${property} in supabase/config.toml`);
  return lines.join("\n");
}

function isolatedConfig(config, projectId, ports) {
  let updated = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
  updated = replacePort(updated, "api", "port", ports.api);
  updated = replacePort(updated, "db", "port", ports.db);
  updated = replacePort(updated, "db", "shadow_port", ports.shadow);
  updated = replacePort(updated, "studio", "port", ports.studio);
  updated += `\n[analytics]\nport = ${ports.analytics}\nvector_port = ${ports.vector}\n`;
  updated += `\n[inbucket]\nenabled = true\nport = ${ports.mailpit}\nsmtp_port = ${ports.smtp}\npop3_port = ${ports.pop3}\n`;
  return updated;
}

async function createIsolatedProject(tempRoot, projectId, ports) {
  const isolatedRoot = join(tempRoot, "project");
  const isolatedSupabase = join(isolatedRoot, "supabase");
  await cp(sourceSupabaseRoot, isolatedSupabase, {
    recursive: true,
    filter: source => {
      const name = source.split(/[\\/]/).at(-1) ?? "";
      return name !== ".temp" && name !== ".branches" && name !== "node_modules" && !name.startsWith(".env");
    }
  });
  const configPath = join(isolatedSupabase, "config.toml");
  const config = await readFile(configPath, "utf8");
  await writeFile(configPath, isolatedConfig(config, projectId, ports));
  return isolatedRoot;
}

function statusFor(projectRoot) {
  const stdout = run([
    "--filter", "fullstack-admin-frontend", "exec", "supabase",
    "--workdir", projectRoot, "status", "--output", "json"
  ]);
  const status = JSON.parse(stdout);
  const url = status.API_URL ?? status.api_url;
  const publishableKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url ?? "") || !publishableKey) {
    throw new Error("The disposable Supabase stack did not return a local API URL and publishable key");
  }
  return { url, publishableKey };
}

async function runDisposableDatabaseChecks(isolatedRoot, projectId, ports) {
  const workdir = ["--filter", "fullstack-admin-frontend", "exec", "supabase", "--workdir", isolatedRoot];
  let stackStopped = false;
  try {
    console.log(`Starting isolated Supabase project ${projectId}.`);
    run([...workdir, "start"]);

    console.log("Replaying migrations twice, checking seed idempotence and database lint.");
    statusFor(isolatedRoot);
    run([...workdir, "db", "reset", "--local"]);
    const seed = await readFile(join(isolatedRoot, "supabase/seed.sql"), "utf8");
    const docker = process.platform === "win32" ? "docker.exe" : "docker";
    const repeatedSeed = spawnSync(docker, [
      "exec", "-i", `supabase_db_${projectId}`,
      "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"
    ], {
      input: seed,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    if (repeatedSeed.error || repeatedSeed.status !== 0) {
      throw new Error(`Repeat seed application failed (${repeatedSeed.error?.message ?? `exit code ${repeatedSeed.status ?? 1}`})`);
    }
    run([...workdir, "db", "lint", "--local", "--level", "warning", "--fail-on", "warning"]);
    run([...workdir, "db", "advisors", "--local", "--type", "all", "--level", "warn", "--fail-on", "warn"]);
    const { url, publishableKey } = statusFor(isolatedRoot);
    const testEnv = {
      SUPABASE_PROJECT_ROOT: isolatedRoot,
      SUPABASE_URL: url,
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
      E2E_MAILPIT_URL: `http://127.0.0.1:${ports.mailpit}`
    };
    run(["exec", "node", "scripts/test-bootstrap-admin.mjs"], { env: testEnv });
    run(["--filter", "fullstack-admin-frontend", "test:db"], { env: testEnv, inherit: true });
    run(["--filter", "fullstack-admin-frontend", "test:e2e:local"], { env: { ...testEnv, CI: "1" }, inherit: true });
  } finally {
    const stop = spawnSync(pnpm, [...workdir, "stop", "--project-id", projectId, "--no-backup"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
    });
    stackStopped = !stop.error && stop.status === 0;
    if (!stackStopped) console.error(`Could not stop the disposable Supabase stack ${projectId}; its workspace is ${isolatedRoot}`);
  }
  if (!stackStopped) throw new Error("Disposable Supabase cleanup failed");
}

async function main() {
  await validateMigrationInventory();
  const projectId = `template-migration-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const portsList = await reservePorts(9);
  const ports = {
    api: portsList[0],
    db: portsList[1],
    shadow: portsList[2],
    studio: portsList[3],
    mailpit: portsList[4],
    smtp: portsList[5],
    pop3: portsList[6],
    analytics: portsList[7],
    vector: portsList[8]
  };
  const tempRoot = await mkdtemp(join(os.tmpdir(), "fullstack-admin-migrations-"));
  const isolatedRoot = await createIsolatedProject(tempRoot, projectId, ports);
  try {
    await runDisposableDatabaseChecks(isolatedRoot, projectId, ports);
    console.log("Disposable empty-database migrations, seed, pgTAP, Storage/Auth integrations, and local Auth browser flow passed.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Migration validation failed");
  process.exitCode = 1;
});
