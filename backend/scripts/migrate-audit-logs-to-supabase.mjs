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
const sensitiveKey = /password|token|authorization|secret|credential|cookie/i;

export function parseArgs(argv) {
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

function idText(value, field) {
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) throw new Error(`Legacy ${field} is not a positive BIGINT`);
  if (BigInt(text) > maxPostgresBigint) throw new Error(`Legacy ${field} exceeds PostgreSQL's signed BIGINT range`);
  return text;
}

function nullableActorId(value, field, mappedProfileIds, stats) {
  if (value === null || value === undefined || value === "" || String(value) === "0") return null;
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) throw new Error(`Legacy ${field} is not a valid user ID`);
  if (BigInt(text) > maxPostgresBigint || !mappedProfileIds.has(text)) {
    stats.unmappedActors += 1;
    return null;
  }
  return text;
}

function textValue(value, field, maxLength, { nullable = false } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new Error(`Legacy ${field} is missing`);
  }
  const text = String(value);
  if (text.length > maxLength || (!nullable && text.trim().length === 0)) {
    throw new Error(`Legacy ${field} is empty or exceeds the target limit`);
  }
  return text;
}

function statusValue(value, field) {
  const number = Number(value);
  if (number !== 0 && number !== 1) throw new Error(`Legacy ${field} must be 0 or 1`);
  return number;
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

export function redactAuditValue(value) {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (!value || typeof value !== "object") return value;
  const redacted = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = sensitiveKey.test(key) ? "***" : redactAuditValue(nested);
  }
  return redacted;
}

export function compactRequestParams(value) {
  if (value === null || value === undefined || value === "") return null;
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Legacy request_params is not valid JSON");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Legacy request_params must be a JSON object");
  }
  const redacted = redactAuditValue(parsed);
  if (Buffer.byteLength(JSON.stringify(redacted), "utf8") <= 3000) return redacted;
  return { truncated: true, reason: "source request parameters exceeded 3000 bytes" };
}

export function redactAuditText(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/\bAuthorization\b\s*[:=]\s*[^,;\r\n]+/gi, "Authorization=***")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer ***")
    .replace(/["']?\b(password|access[_-]?token|refresh[_-]?token|authorization|secret|credential)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi, "$1=***");
}

export function mapLegacyLoginLog(row, mappedProfileIds, stats) {
  return {
    id: idText(row.id, "login log id"),
    user_id: nullableActorId(row.user_id, "login log user_id", mappedProfileIds, stats),
    login_name: textValue(row.login_name, "login_name", 64),
    login_ip: textValue(row.login_ip, "login_ip", 64, { nullable: true }),
    user_agent: textValue(row.user_agent, "user_agent", 512, { nullable: true }),
    login_result: statusValue(row.login_result, "login_result"),
    failure_reason: redactAuditText(textValue(row.failure_reason, "failure_reason", 255, { nullable: true })),
    logged_at: utcIso(row.logged_at_utc, "logged_at")
  };
}

export function mapLegacyOperationLog(row, mappedProfileIds, stats) {
  return {
    id: idText(row.id, "operation log id"),
    operator_id: nullableActorId(row.operator_id, "operator_id", mappedProfileIds, stats),
    operator_name: textValue(row.operator_name, "operator_name", 128, { nullable: true }),
    module_code: textValue(row.module_code, "module_code", 64),
    operation_type: textValue(row.operation_type, "operation_type", 32),
    request_method: textValue(row.request_method, "request_method", 16),
    request_path: textValue(row.request_path, "request_path", 255),
    request_params: compactRequestParams(row.request_params),
    operation_result: statusValue(row.operation_result, "operation_result"),
    error_message: redactAuditText(textValue(row.error_message, "error_message", Infinity, { nullable: true })),
    operated_at: utcIso(row.operated_at_utc, "operated_at")
  };
}

export function mapLegacyExceptionLog(row) {
  return {
    id: idText(row.id, "exception log id"),
    request_path: textValue(row.request_path, "request_path", 255),
    request_method: textValue(row.request_method, "request_method", 16),
    error_type: textValue(row.error_type, "error_type", 128),
    error_message: redactAuditText(textValue(row.error_message, "error_message", Infinity)),
    stack_summary: redactAuditText(textValue(row.stack_summary, "stack_summary", Infinity, { nullable: true })),
    handled_status: statusValue(row.handled_status, "handled_status"),
    occurred_at: utcIso(row.occurred_at_utc, "occurred_at")
  };
}

const sources = {
  login: {
    rpc: "import_legacy_login_logs",
    query: `SELECT id, user_id, login_name, login_ip, user_agent, login_result, failure_reason,
                   CONVERT_TZ(logged_at, ?, '+00:00') AS logged_at_utc
            FROM login_logs WHERE id > ? ORDER BY id ASC LIMIT ?`,
    mapper: mapLegacyLoginLog
  },
  operation: {
    rpc: "import_legacy_operation_logs",
    query: `SELECT id, operator_id, operator_name, module_code, operation_type,
                   request_method, request_path, request_params, operation_result,
                   error_message, CONVERT_TZ(operated_at, ?, '+00:00') AS operated_at_utc
            FROM operation_logs WHERE id > ? ORDER BY id ASC LIMIT ?`,
    mapper: mapLegacyOperationLog
  },
  exception: {
    rpc: "import_legacy_exception_logs",
    query: `SELECT id, request_path, request_method, error_type, error_message,
                   stack_summary, handled_status,
                   CONVERT_TZ(occurred_at, ?, '+00:00') AS occurred_at_utc
            FROM exception_logs WHERE id > ? ORDER BY id ASC LIMIT ?`,
    mapper: mapLegacyExceptionLog
  }
};

async function readTargetProfileIds(target) {
  const ids = new Set();
  for (let offset = 0; offset <= 100_000; offset += 1000) {
    const url = new URL(`${target.apiUrl}/rest/v1/profiles`);
    url.searchParams.set("select", "id");
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("limit", "1000");
    const response = await fetch(url, {
      headers: {
        apikey: target.serviceRoleKey,
        Authorization: `Bearer ${target.serviceRoleKey}`,
        Range: `${offset}-${offset + 999}`,
        "Range-Unit": "items"
      }
    });
    const rows = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(rows)) throw new Error("Could not inspect local business profile mappings");
    for (const row of rows) {
      if (typeof row.id === "string" && /^[1-9]\d*$/.test(row.id)) {
        ids.add(row.id);
      } else if (typeof row.id === "number" && Number.isSafeInteger(row.id) && row.id > 0) {
        ids.add(String(row.id));
      } else {
        throw new Error("Local profile IDs cannot be represented losslessly");
      }
    }
    if (rows.length < 1000) return ids;
  }
  throw new Error("Local profile mapping count exceeds the safe scan limit");
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
  if (status.error || status.status !== 0) throw new Error("This importer requires this project's running Supabase Local stack");
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
    typeof serviceRoleKey !== "string" ||
    !serviceRoleKey
  ) throw new Error("This importer only accepts this project's local Supabase API and key");
  return { apiUrl, serviceRoleKey };
}

async function readSourceRows(connection, entity, timezone, mappedProfileIds) {
  const source = sources[entity];
  const rows = [];
  const stats = { unmappedActors: 0 };
  let cursor = "0";
  while (true) {
    const [batch] = await connection.execute(source.query, [timezone, cursor, batchSize]);
    const mapped = batch.map(row => source.mapper(row, mappedProfileIds, stats));
    rows.push(...mapped);
    if (rows.length > 100_000) throw new Error(`Legacy ${entity} logs exceed the safe scan limit`);
    if (batch.length < batchSize) break;
    cursor = mapped.at(-1).id;
  }
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`Legacy ${entity} logs contain duplicate IDs`);
    ids.add(row.id);
  }
  return { rows, unmappedActors: stats.unmappedActors };
}

async function importBatch(target, entity, rows, apply) {
  const response = await fetch(`${target.apiUrl}/rest/v1/rpc/${sources[entity].rpc}`, {
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
    throw new Error(`Supabase rejected the ${entity} log import (${result?.code ?? "unknown"})`);
  }
  for (const field of ["sourceCount", "alreadyPresentCount", "rowsToInsert", "insertedCount"]) {
    if (!Number.isSafeInteger(result[field]) || result[field] < 0) {
      throw new Error(`Supabase returned an invalid ${entity} log import count`);
    }
  }
  return result;
}

async function runImport(target, entity, rows, apply) {
  const totals = { sourceCount: 0, alreadyPresentCount: 0, rowsToInsert: 0, insertedCount: 0 };
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const preview = await importBatch(target, entity, batch, false);
    if (preview.sourceCount !== batch.length) throw new Error(`Unexpected ${entity} log preview count`);
    const result = apply ? await importBatch(target, entity, batch, true) : preview;
    if (result.sourceCount !== batch.length || result.rowsToInsert !== preview.rowsToInsert) {
      throw new Error(`${entity} logs changed during import`);
    }
    for (const key of Object.keys(totals)) totals[key] += preview[key];
    if (apply) totals.insertedCount += result.insertedCount;
  }
  return totals;
}

function usage() {
  return [
    "Read-only preview (default):",
    "  node scripts/migrate-audit-logs-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone>",
    "Apply to this project's local Supabase only:",
    "  node scripts/migrate-audit-logs-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone> --apply-local"
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
  const env = dotenv.config({ path: resolve(backendDirectory, ".env"), quiet: true });
  if (env.error) throw new Error("Could not load backend/.env; no source connection was attempted");
  const sourceDatabase = process.env.MYSQL_DATABASE || "admin_template";
  const sourceHost = process.env.MYSQL_HOST || "localhost";
  if (!new Set(["localhost", "127.0.0.1", "::1"]).has(sourceHost)) throw new Error("This importer refuses non-local MySQL hosts");
  if (!args.confirmDatabase || args.confirmDatabase !== sourceDatabase) {
    throw new Error("Pass --confirm-source-database with the exact MYSQL_DATABASE after confirming its ownership");
  }
  if (!args.sourceTimezone) throw new Error("Pass --source-timezone after checking the source database timezone");
  if (!process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) throw new Error("MySQL source credentials are missing; no connection was attempted");

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
    const [timezoneRows] = await connection.execute(
      "SELECT CONVERT_TZ('2000-01-01 00:00:00', ?, '+00:00') AS converted",
      [args.sourceTimezone]
    );
    if (!timezoneRows[0]?.converted) throw new Error("MySQL could not resolve the source timezone");

    const mappedProfileIds = await readTargetProfileIds(target);
    const mapped = {};
    for (const entity of Object.keys(sources)) {
      mapped[entity] = await readSourceRows(
        connection,
        entity,
        args.sourceTimezone,
        sources[entity].userField ? mappedProfileIds : new Set()
      );
    }
    const report = {};
    for (const entity of Object.keys(sources)) {
      const preview = await runImport(target, entity, mapped[entity].rows, false);
      report[entity] = {
        sourceRows: mapped[entity].rows.length,
        unmappedActors: mapped[entity].unmappedActors,
        alreadyPresentRows: preview.alreadyPresentCount,
        rowsToInsert: preview.rowsToInsert,
        insertedRows: 0
      };
    }
    if (args.applyLocal) {
      for (const entity of Object.keys(sources)) {
        const applied = await runImport(target, entity, mapped[entity].rows, true);
        report[entity].insertedRows = applied.insertedCount;
      }
    }
    await connection.commit();
    process.stdout.write(`${JSON.stringify({
      mode: args.applyLocal ? "apply-local" : "preview-only",
      sourceDatabase,
      sourceHost,
      target: "local-supabase",
      logs: report
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
    process.stderr.write(`${error instanceof Error ? error.message : "Audit log import failed"}\n`);
    process.exitCode = 1;
  });
}
