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
const batchSize = 200;

const sourceBatchSql = `
  SELECT
    id,
    receiver_id,
    sender_id,
    title,
    summary,
    content,
    message_type,
    read_status,
    CONVERT_TZ(sent_at, ?, '+00:00') AS sent_at_utc,
    CASE WHEN read_at IS NULL THEN NULL
         ELSE CONVERT_TZ(read_at, ?, '+00:00') END AS read_at_utc,
    created_by,
    CONVERT_TZ(created_at, ?, '+00:00') AS created_at_utc,
    updated_by,
    CONVERT_TZ(updated_at, ?, '+00:00') AS updated_at_utc,
    deleted
  FROM messages
  WHERE id > ?
  ORDER BY id ASC
  LIMIT ?`;

function positiveBigintText(value, field, nullable = false) {
  if ((value === null || value === undefined) && nullable) return null;
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`Legacy ${field} is not a positive BIGINT`);
  }
  if (BigInt(text) > maxPostgresBigint) {
    throw new Error(`Legacy ${field} exceeds PostgreSQL's signed BIGINT range`);
  }
  return text;
}

function requiredText(value, field, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Legacy ${field} is empty or invalid`);
  }
  if (value.length > maxLength) {
    throw new Error(`Legacy ${field} exceeds the Supabase column limit`);
  }
  return value;
}

function nullableText(value, field, maxLength) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Legacy ${field} exceeds the Supabase column limit`);
  }
  return value;
}

function utcIso(value, field, nullable = false) {
  if ((value === null || value === undefined) && nullable) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Legacy ${field} could not be converted to UTC`);
  }
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Legacy ${field} could not be converted to UTC`);
  }
  return date.toISOString();
}

export function mapLegacyMessageRow(row) {
  const readStatus = Number(row.read_status);
  const deleted = Number(row.deleted);
  if (readStatus !== 0 && readStatus !== 1) {
    throw new Error("Legacy read_status must be 0 or 1");
  }
  if (deleted !== 0 && deleted !== 1) {
    throw new Error("Legacy deleted must be 0 or 1");
  }

  return {
    id: positiveBigintText(row.id, "id"),
    receiver_id: positiveBigintText(row.receiver_id, "receiver_id"),
    sender_id: positiveBigintText(row.sender_id, "sender_id", true),
    title: requiredText(row.title, "title", 128),
    summary: nullableText(row.summary, "summary", 255),
    content: typeof row.content === "string" ? row.content : String(row.content ?? ""),
    message_type: requiredText(row.message_type, "message_type", 32),
    read_status: readStatus === 1,
    sent_at: utcIso(row.sent_at_utc, "sent_at"),
    read_at: utcIso(row.read_at_utc, "read_at", true),
    created_by: positiveBigintText(row.created_by, "created_by", true),
    created_at: utcIso(row.created_at_utc, "created_at"),
    updated_by: positiveBigintText(row.updated_by, "updated_by", true),
    updated_at: utcIso(row.updated_at_utc, "updated_at"),
    deleted: deleted === 1
  };
}

function parseArgs(argv) {
  const result = { applyLocal: false, confirmDatabase: "", sourceTimezone: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply-local") {
      result.applyLocal = true;
    } else if (argument === "--confirm-source-database") {
      result.confirmDatabase = argv[++index] ?? "";
    } else if (argument.startsWith("--confirm-source-database=")) {
      result.confirmDatabase = argument.split("=", 2)[1] ?? "";
    } else if (argument === "--source-timezone") {
      result.sourceTimezone = argv[++index] ?? "";
    } else if (argument.startsWith("--source-timezone=")) {
      result.sourceTimezone = argument.split("=", 2)[1] ?? "";
    } else if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else {
      throw new Error(`Unsupported argument: ${argument}`);
    }
  }
  return result;
}

function getLocalSupabaseCredentials() {
  const status = spawnSync(
    supabaseCli,
    ["--workdir", "..", "status", "--output", "json"],
    { cwd: frontendDirectory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  if (status.status !== 0) throw new Error("This command requires this project's Supabase Local stack");

  let output;
  try {
    output = JSON.parse(status.stdout);
  } catch {
    throw new Error("Supabase Local status did not return valid JSON");
  }

  const apiUrl = output.API_URL ?? output.api_url;
  const serviceRoleKey = output.SERVICE_ROLE_KEY ?? output.service_role_key;
  if (
    typeof apiUrl !== "string" ||
    !/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(apiUrl) ||
    typeof serviceRoleKey !== "string" ||
    serviceRoleKey.length === 0
  ) {
    throw new Error("This importer only accepts the local Supabase API and key");
  }
  return { apiUrl, serviceRoleKey };
}

async function callImportRpc(target, rows, apply) {
  const response = await fetch(`${target.apiUrl}/rest/v1/rpc/import_legacy_messages`, {
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
    throw new Error(`Supabase rejected a message import batch (${code})`);
  }
  return result;
}

async function scanMessages(connection, sourceTimezone, target, apply) {
  let cursor = "0";
  let sourceRows = 0;
  let alreadyPresentRows = 0;
  let rowsToInsert = 0;
  let insertedRows = 0;

  while (true) {
    const [sourceBatch] = await connection.execute(sourceBatchSql, [
      sourceTimezone,
      sourceTimezone,
      sourceTimezone,
      sourceTimezone,
      cursor,
      batchSize
    ]);
    if (!sourceBatch.length) break;

    const mappedRows = sourceBatch.map(mapLegacyMessageRow);
    const result = await callImportRpc(target, mappedRows, apply);
    sourceRows += Number(result.sourceCount ?? 0);
    alreadyPresentRows += Number(result.alreadyPresentCount ?? 0);
    rowsToInsert += Number(result.rowsToInsert ?? 0);
    insertedRows += Number(result.insertedCount ?? 0);
    cursor = mappedRows.at(-1).id;
    if (sourceBatch.length < batchSize) break;
  }

  return { sourceRows, alreadyPresentRows, rowsToInsert, insertedRows };
}

function usage() {
  return [
    "Read-only preview (default):",
    "  node scripts/migrate-messages-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone>",
    "Apply to this project's local Supabase only:",
    "  node scripts/migrate-messages-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone> --apply-local"
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
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(sourceHost)) {
    throw new Error("This importer refuses non-local MySQL hosts");
  }
  if (!args.confirmDatabase || args.confirmDatabase !== sourceDatabase) {
    throw new Error("Pass --confirm-source-database with the exact MYSQL_DATABASE after confirming its ownership");
  }
  if (!args.sourceTimezone) {
    throw new Error("Pass --source-timezone after checking backend/db/preflight-messages.sql");
  }
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
    if (!timezoneProbe[0][0]?.converted) {
      throw new Error("MySQL could not resolve the requested source timezone");
    }

    const preview = await scanMessages(connection, args.sourceTimezone, target, false);
    let applied = null;
    if (args.applyLocal) {
      applied = await scanMessages(connection, args.sourceTimezone, target, true);
    }
    await connection.commit();

    process.stdout.write(`${JSON.stringify({
      mode: args.applyLocal ? "apply-local" : "preview-only",
      sourceDatabase,
      sourceHost,
      sourceRows: preview.sourceRows,
      alreadyPresentRows: preview.alreadyPresentRows,
      rowsToInsert: preview.rowsToInsert,
      insertedRows: applied?.insertedRows ?? 0,
      target: "local-supabase"
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
    process.stderr.write(`${error instanceof Error ? error.message : "Message import failed"}\n`);
    process.exitCode = 1;
  });
}
