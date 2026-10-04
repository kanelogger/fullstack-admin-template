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
const valueTypes = new Set(["STRING", "NUMBER", "BOOLEAN", "JSON"]);
const entities = {
  dictionaryTypes: {
    rpc: "import_legacy_dict_types"
  },
  dictionaryItems: {
    rpc: "import_legacy_dict_items"
  },
  systemConfigs: {
    rpc: "import_legacy_system_configs"
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

function requiredText(value, field, maxLength = Infinity) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Legacy ${field} is empty or invalid`);
  }
  if (value.length > maxLength) throw new Error(`Legacy ${field} exceeds the Supabase column limit`);
  return value;
}

function nullableText(value, field, maxLength = Infinity) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Legacy ${field} exceeds the Supabase column limit`);
  }
  return value;
}

function statusValue(value) {
  const status = Number(value);
  if (status !== 0 && status !== 1) throw new Error("Legacy status must be 0 or 1");
  return status;
}

function deletedValue(value) {
  const deleted = Number(value);
  if (deleted !== 0 && deleted !== 1) throw new Error("Legacy deleted must be 0 or 1");
  return deleted;
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

export function mapLegacyDictionaryType(row) {
  return {
    id: positiveBigintText(row.id, "dictionary type id"),
    dict_code: requiredText(row.dict_code, "dict_code", 64),
    dict_name: requiredText(row.dict_name, "dict_name", 128),
    status: statusValue(row.status),
    description: nullableText(row.description, "description", 255),
    created_by: positiveBigintText(row.created_by, "created_by", true),
    updated_by: positiveBigintText(row.updated_by, "updated_by", true),
    deleted: deletedValue(row.deleted),
    created_at: utcIso(row.created_at_utc, "created_at"),
    updated_at: utcIso(row.updated_at_utc, "updated_at")
  };
}

export function mapLegacyDictionaryItem(row) {
  const sortOrder = Number(row.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < -2_147_483_648 || sortOrder > 2_147_483_647) {
    throw new Error("Legacy sort_order is outside PostgreSQL INTEGER range");
  }
  return {
    id: positiveBigintText(row.id, "dictionary item id"),
    dict_type_id: positiveBigintText(row.dict_type_id, "dict_type_id"),
    item_value: requiredText(row.item_value, "item_value", 64),
    item_label: requiredText(row.item_label, "item_label", 128),
    sort_order: sortOrder,
    status: statusValue(row.status),
    description: nullableText(row.description, "description", 255),
    created_by: positiveBigintText(row.created_by, "created_by", true),
    updated_by: positiveBigintText(row.updated_by, "updated_by", true),
    deleted: deletedValue(row.deleted),
    created_at: utcIso(row.created_at_utc, "created_at"),
    updated_at: utcIso(row.updated_at_utc, "updated_at")
  };
}

export function mapLegacySystemConfig(row) {
  const valueType = String(row.value_type ?? "STRING").trim().toUpperCase();
  if (!valueTypes.has(valueType)) throw new Error("Legacy value_type is not supported");
  return {
    id: positiveBigintText(row.id, "system config id"),
    config_code: requiredText(row.config_code, "config_code", 64),
    config_name: requiredText(row.config_name, "config_name", 128),
    config_value: requiredText(row.config_value, "config_value"),
    value_type: valueType,
    status: statusValue(row.status),
    description: nullableText(row.description, "description", 255),
    created_by: positiveBigintText(row.created_by, "created_by", true),
    updated_by: positiveBigintText(row.updated_by, "updated_by", true),
    deleted: deletedValue(row.deleted),
    created_at: utcIso(row.created_at_utc, "created_at"),
    updated_at: utcIso(row.updated_at_utc, "updated_at")
  };
}

const sourceQueries = {
  dictionaryTypes: `
    SELECT id, dict_code, dict_name, status, description, created_by, updated_by, deleted,
           CONVERT_TZ(created_at, ?, '+00:00') AS created_at_utc,
           CONVERT_TZ(updated_at, ?, '+00:00') AS updated_at_utc
    FROM dict_types WHERE id > ? ORDER BY id ASC LIMIT ?`,
  dictionaryItems: `
    SELECT id, dict_type_id, item_value, item_label, sort_order, status, description,
           created_by, updated_by, deleted,
           CONVERT_TZ(created_at, ?, '+00:00') AS created_at_utc,
           CONVERT_TZ(updated_at, ?, '+00:00') AS updated_at_utc
    FROM dict_items WHERE id > ? ORDER BY id ASC LIMIT ?`,
  systemConfigs: `
    SELECT id, config_code, config_name, config_value, value_type, status, description,
           created_by, updated_by, deleted,
           CONVERT_TZ(created_at, ?, '+00:00') AS created_at_utc,
           CONVERT_TZ(updated_at, ?, '+00:00') AS updated_at_utc
    FROM system_configs WHERE id > ? ORDER BY id ASC LIMIT ?`
};

const mappers = {
  dictionaryTypes: mapLegacyDictionaryType,
  dictionaryItems: mapLegacyDictionaryItem,
  systemConfigs: mapLegacySystemConfig
};

async function readRows(connection, entity, sourceTimezone) {
  const rows = [];
  let cursor = "0";
  while (true) {
    const [batch] = await connection.execute(sourceQueries[entity], [
      sourceTimezone,
      sourceTimezone,
      cursor,
      batchSize
    ]);
    const mapped = batch.map(mappers[entity]);
    rows.push(...mapped);
    if (rows.length > 100_000) throw new Error(`Legacy ${entity} exceed the safe scan limit`);
    if (batch.length < batchSize) break;
    cursor = mapped.at(-1).id;
  }
  validateUniqueRows(entity, rows);
  return rows;
}

function uniqueKey(entity, row) {
  switch (entity) {
    case "dictionaryTypes": return row.dict_code.toLocaleLowerCase("en-US");
    case "dictionaryItems": return `${row.dict_type_id}\u0000${row.item_value.toLocaleLowerCase("en-US")}\u0000${row.deleted}`;
    case "systemConfigs": return row.config_code.toLocaleLowerCase("en-US");
  }
}

export function validateUniqueRows(entity, rows) {
  const ids = new Set();
  const keys = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error(`Legacy ${entity} contain duplicate IDs`);
    ids.add(row.id);
    const key = uniqueKey(entity, row);
    if (keys.has(key)) throw new Error(`Legacy ${entity} contain duplicate business keys`);
    keys.add(key);
  }
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

async function importBatch(target, entity, rows, apply, sourceTypeIds) {
  const rpc = entities[entity].rpc;
  const body = { p_rows: rows };
  if (entity === "dictionaryItems") body.p_source_type_ids = sourceTypeIds;
  body.p_apply = apply;
  const response = await fetch(`${target.apiUrl}/rest/v1/rpc/${rpc}`, {
    method: "POST",
    headers: {
      apikey: target.serviceRoleKey,
      Authorization: `Bearer ${target.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object") {
    const code = result?.code ?? result?.error_code ?? "unknown";
    throw new Error(`Supabase rejected the ${entity} import batch (${code})`);
  }
  for (const key of ["sourceCount", "alreadyPresentCount", "rowsToInsert", "insertedCount"]) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) {
      throw new Error(`Supabase returned an invalid ${entity} import count`);
    }
  }
  return result;
}

async function runImport(target, entity, rows, apply, sourceTypeIds = []) {
  const totals = {
    sourceCount: 0,
    alreadyPresentCount: 0,
    rowsToInsert: 0,
    insertedCount: 0
  };
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const result = await importBatch(
      target,
      entity,
      rows.slice(offset, offset + batchSize),
      apply,
      sourceTypeIds
    );
    for (const key of Object.keys(totals)) totals[key] += result[key];
  }
  if (totals.sourceCount !== rows.length) {
    throw new Error(`Supabase counted an unexpected number of ${entity}`);
  }
  return totals;
}

function usage() {
  return [
    "Read-only preview (default):",
    "  node scripts/migrate-dictionary-configuration-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone>",
    "Apply to this project's local Supabase only:",
    "  node scripts/migrate-dictionary-configuration-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone> --apply-local"
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

    const source = {};
    for (const entity of Object.keys(entities)) {
      source[entity] = await readRows(connection, entity, args.sourceTimezone);
    }
    const sourceTypeIds = source.dictionaryTypes.map(row => row.id);
    if (sourceTypeIds.length > 500) {
      throw new Error("The legacy dictionary type count exceeds the safe item-import reference limit");
    }

    const preview = {};
    for (const entity of Object.keys(entities)) {
      preview[entity] = await runImport(
        target,
        entity,
        source[entity],
        false,
        sourceTypeIds
      );
    }
    const applied = {};
    if (args.applyLocal) {
      for (const entity of Object.keys(entities)) {
        applied[entity] = await runImport(
          target,
          entity,
          source[entity],
          true,
          sourceTypeIds
        );
      }
    }

    await connection.commit();
    process.stdout.write(`${JSON.stringify({
      mode: args.applyLocal ? "apply-local" : "preview-only",
      sourceDatabase,
      sourceHost,
      target: "local-supabase",
      entities: Object.fromEntries(Object.keys(entities).map(entity => [entity, {
        sourceRows: source[entity].length,
        alreadyPresentRows: preview[entity].alreadyPresentCount,
        rowsToInsert: preview[entity].rowsToInsert,
        insertedRows: applied[entity]?.insertedCount ?? 0
      }]))
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
    process.stderr.write(`${error instanceof Error ? error.message : "Configuration import failed"}\n`);
    process.exitCode = 1;
  });
}
