import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(backendDirectory, "..");
const frontendDirectory = resolve(repositoryDirectory, "frontend");
const supabaseCli = resolve(frontendDirectory, "node_modules/.bin/supabase");
const requireBackend = createRequire(import.meta.url);
const maxPostgresBigint = 9_223_372_036_854_775_807n;
const batchSize = 100;
const sourceTables = {
  departments: {
    rpc: "import_legacy_departments",
    codeColumn: "dept_code",
    nameColumn: "dept_name",
    codeLabel: "department code",
    nameLabel: "department name"
  },
  posts: {
    rpc: "import_legacy_posts",
    codeColumn: "post_code",
    nameColumn: "post_name",
    codeLabel: "post code",
    nameLabel: "post name"
  }
};

function parseArgs(argv) {
  const result = { applyLocal: false, confirmDatabase: "", sourceTimezone: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply-local") result.applyLocal = true;
    else if (argument === "--confirm-source-database") result.confirmDatabase = argv[++index] ?? "";
    else if (argument.startsWith("--confirm-source-database=")) result.confirmDatabase = argument.split("=", 2)[1] ?? "";
    else if (argument === "--source-timezone") result.sourceTimezone = argv[++index] ?? "";
    else if (argument.startsWith("--source-timezone=")) result.sourceTimezone = argument.split("=", 2)[1] ?? "";
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  return result;
}

function positiveBigintText(value, field, nullable = false) {
  if ((value === null || value === undefined) && nullable) return null;
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) throw new Error(`Legacy ${field} is not a positive BIGINT`);
  if (BigInt(text) > maxPostgresBigint) {
    throw new Error(`Legacy ${field} exceeds PostgreSQL's signed BIGINT range`);
  }
  return text;
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Legacy ${field} is empty or invalid`);
  }
  if (value !== value.trim()) {
    throw new Error(`Legacy ${field} has surrounding whitespace; clean the source before import`);
  }
  if (value.length > maxLength) throw new Error(`Legacy ${field} exceeds the Supabase column limit`);
  return value;
}

function nullableText(value, field, maxLength) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Legacy ${field} exceeds the Supabase column limit`);
  }
  return value;
}

function utcIso(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Legacy ${field} could not be converted to UTC`);
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Legacy ${field} could not be converted to UTC`);
  return date.toISOString();
}

export function mapLegacyOrganizationRow(kind, row) {
  const source = sourceTables[kind];
  if (!source) throw new Error(`Unsupported organization entity: ${kind}`);
  const status = Number(row.status);
  const deleted = Number(row.deleted);
  if (status !== 0 && status !== 1) throw new Error("Legacy status must be 0 or 1");
  if (deleted !== 0 && deleted !== 1) throw new Error("Legacy deleted must be 0 or 1");

  const result = {
    id: positiveBigintText(row.id, "id"),
    [source.codeColumn]: requiredText(row[source.codeColumn], source.codeLabel, 64),
    [source.nameColumn]: requiredText(row[source.nameColumn], source.nameLabel, 128),
    status,
    description: nullableText(row.description, "description", 255),
    deleted: deleted === 1,
    created_at: utcIso(row.created_at_utc, "created_at"),
    updated_at: utcIso(row.updated_at_utc, "updated_at")
  };
  return result;
}

export function validateUniqueOrganizationCodes(kind, rows) {
  const source = sourceTables[kind];
  if (!source) throw new Error(`Unsupported organization entity: ${kind}`);
  const ids = new Set();
  const codes = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`Legacy ${kind} contain duplicate IDs`);
    ids.add(row.id);
    const code = row[source.codeColumn].toLocaleLowerCase("en-US");
    if (codes.has(code)) throw new Error(`Legacy ${kind} contain case-insensitive duplicate codes`);
    codes.add(code);
  }
}

const sourceQueries = {
  departments: `
    SELECT id, dept_code, dept_name, status, description, deleted,
           CONVERT_TZ(created_at, ?, '+00:00') AS created_at_utc,
           CONVERT_TZ(updated_at, ?, '+00:00') AS updated_at_utc
    FROM departments
    WHERE id > ?
    ORDER BY id ASC
    LIMIT ?`,
  posts: `
    SELECT id, post_code, post_name, status, description, deleted,
           CONVERT_TZ(created_at, ?, '+00:00') AS created_at_utc,
           CONVERT_TZ(updated_at, ?, '+00:00') AS updated_at_utc
    FROM posts
    WHERE id > ?
    ORDER BY id ASC
    LIMIT ?`
};

async function readOrganizationRows(connection, kind, sourceTimezone) {
  const rows = [];
  let cursor = "0";
  while (true) {
    const [batch] = await connection.execute(sourceQueries[kind], [
      sourceTimezone,
      sourceTimezone,
      cursor,
      batchSize
    ]);
    const mapped = batch.map(row => mapLegacyOrganizationRow(kind, row));
    rows.push(...mapped);
    if (rows.length > 100_000) throw new Error(`Legacy ${kind} exceed the safe scan limit`);
    if (batch.length < batchSize) break;
    cursor = mapped.at(-1).id;
  }
  validateUniqueOrganizationCodes(kind, rows);
  return rows;
}

function getLocalSupabaseCredentials() {
  const status = spawnSync(
    supabaseCli,
    ["--workdir", repositoryDirectory, "status", "--output", "json"],
    {
      cwd: frontendDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
    }
  );
  if (status.error || status.status !== 0) {
    throw new Error("This command requires this project's running Supabase Local stack");
  }

  let output;
  try {
    output = JSON.parse(status.stdout);
  } catch {
    throw new Error("Supabase Local status did not return valid JSON");
  }
  const apiUrl = output.API_URL ?? output.api_url;
  const serviceRoleKey = output.SERVICE_ROLE_KEY ?? output.service_role_key ?? output.SECRET_KEY;
  if (
    typeof apiUrl !== "string" ||
    !/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(apiUrl) ||
    typeof serviceRoleKey !== "string" || !serviceRoleKey
  ) {
    throw new Error("This importer only accepts this project's local Supabase API and key");
  }
  return { apiUrl, serviceRoleKey };
}

async function importBatch(target, kind, rows, apply) {
  const rpc = sourceTables[kind].rpc;
  const response = await fetch(`${target.apiUrl}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: target.serviceRoleKey,
      Authorization: `Bearer ${target.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ p_rows: rows, p_apply: apply })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object") {
    const code = result?.code ?? result?.error_code ?? "unknown";
    throw new Error(`Supabase rejected the ${kind} import batch (${code})`);
  }
  for (const key of ["sourceCount", "alreadyPresentCount", "rowsToInsert", "insertedCount"]) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) {
      throw new Error(`Supabase returned an invalid ${kind} import count`);
    }
  }
  return result;
}

async function runImport(target, kind, rows, apply) {
  const totals = {
    sourceCount: 0,
    alreadyPresentCount: 0,
    rowsToInsert: 0,
    insertedCount: 0
  };
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const result = await importBatch(target, kind, rows.slice(offset, offset + batchSize), apply);
    for (const key of Object.keys(totals)) totals[key] += result[key];
  }
  if (totals.sourceCount !== rows.length) {
    throw new Error(`Supabase counted an unexpected number of ${kind}`);
  }
  return totals;
}

function usage() {
  return [
    "Read-only preview (default):",
    "  node scripts/migrate-organization-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone>",
    "Apply to this project's local Supabase only:",
    "  node scripts/migrate-organization-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone> --apply-local"
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const dotenv = requireBackend("dotenv");
  const mysql = requireBackend("mysql2/promise");
  const dotenvResult = dotenv.config({ path: resolve(backendDirectory, ".env"), quiet: true });
  if (dotenvResult.error) throw new Error("Could not load backend/.env; no source connection was attempted");

  const sourceDatabase = process.env.MYSQL_DATABASE || "admin_template";
  const sourceHost = process.env.MYSQL_HOST || "localhost";
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(sourceHost)) {
    throw new Error("This importer refuses non-local MySQL hosts");
  }
  if (!args.confirmDatabase || args.confirmDatabase !== sourceDatabase) {
    throw new Error("Pass --confirm-source-database with the exact MYSQL_DATABASE after confirming its ownership");
  }
  if (!args.sourceTimezone) throw new Error("Pass --source-timezone after checking the source database timezone");
  if (!process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
    throw new Error("MySQL source credentials are missing; no connection was attempted");
  }

  const target = getLocalSupabaseCredentials();
  const connection = await mysql.createConnection({
    host: sourceHost,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: sourceDatabase,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true
  });

  try {
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const timezoneProbe = await connection.execute(
      "SELECT CONVERT_TZ('2000-01-01 00:00:00', ?, '+00:00') AS converted",
      [args.sourceTimezone]
    );
    if (!timezoneProbe[0][0]?.converted) throw new Error("MySQL could not resolve the source timezone");

    const organizations = {};
    for (const kind of Object.keys(sourceTables)) {
      organizations[kind] = await readOrganizationRows(connection, kind, args.sourceTimezone);
    }

    const report = {};
    for (const kind of Object.keys(sourceTables)) {
      const preview = await runImport(target, kind, organizations[kind], false);
      report[kind] = {
        sourceRows: organizations[kind].length,
        alreadyPresentRows: preview.alreadyPresentCount,
        rowsToInsert: preview.rowsToInsert,
        insertedRows: 0
      };
    }
    if (args.applyLocal) {
      for (const kind of Object.keys(sourceTables)) {
        const applied = await runImport(target, kind, organizations[kind], true);
        report[kind].insertedRows = applied.insertedCount;
      }
    }

    await connection.commit();
    process.stdout.write(`${JSON.stringify({
      mode: args.applyLocal ? "apply-local" : "preview-only",
      sourceDatabase,
      sourceHost,
      target: "local-supabase",
      organizations: report
    }, null, 2)}\n`);
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Organization import failed"}\n`);
    process.exitCode = 1;
  });
}
