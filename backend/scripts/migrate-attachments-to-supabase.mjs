import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(scriptDirectory, "..");
const repositoryDirectory = resolve(backendDirectory, "..");
const frontendDirectory = resolve(repositoryDirectory, "frontend");
const supabaseCli = resolve(frontendDirectory, "node_modules/.bin/supabase");
const requireBackend = createRequire(import.meta.url);
const uploadRoot = resolve(backendDirectory, "uploads/attachments");
const maxPostgresBigint = 9_223_372_036_854_775_807n;
const maxFileSize = 20 * 1024 * 1024;
const batchSize = 100;
const bucket = "admin-attachments";

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

function bigintText(value, field, { nullable = false, positive = true } = {}) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value);
  const expression = positive ? /^[1-9]\d*$/ : /^(0|[1-9]\d*)$/;
  if (!expression.test(text)) throw new Error(`Legacy ${field} is not a valid BIGINT`);
  if (BigInt(text) > maxPostgresBigint) {
    throw new Error(`Legacy ${field} exceeds PostgreSQL's signed BIGINT range`);
  }
  return text;
}

function textValue(value, field, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`Legacy ${field} is empty or exceeds the target limit`);
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Legacy ${field} contains control characters`);
  return value;
}

function nullableText(value, field, maxLength) {
  if (value === null || value === undefined || value.trim?.() === "") return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Legacy ${field} exceeds the target limit`);
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

function binaryPath(storedName) {
  if (
    typeof storedName !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(storedName) ||
    storedName === "." ||
    storedName === ".."
  ) {
    throw new Error("Legacy stored filename is invalid");
  }
  const path = resolve(uploadRoot, storedName);
  const fromRoot = relative(uploadRoot, path);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new Error("Legacy attachment path escapes the upload directory");
  }
  return path;
}

export function mapLegacyAttachment(row) {
  const sizeText = bigintText(row.file_size, "file_size", { positive: false });
  const fileSize = Number(sizeText);
  if (!Number.isSafeInteger(fileSize) || fileSize > maxFileSize) {
    throw new Error("Legacy file_size is outside the 20 MiB Storage limit");
  }
  const deleted = Number(row.deleted);
  const referenceStatus = Number(row.reference_status);
  if (deleted !== 0 && deleted !== 1) throw new Error("Legacy deleted must be 0 or 1");
  if (referenceStatus !== 0 && referenceStatus !== 1) {
    throw new Error("Legacy reference_status must be 0 or 1");
  }
  const storedName = textValue(row.stored_name, "stored_name", 255);
  binaryPath(storedName);
  const id = bigintText(row.id, "id");
  return {
    id,
    original_name: textValue(row.original_name, "original_name", 255),
    storage_path: `legacy/${id}/${storedName}`,
    mime_type: textValue(row.mime_type, "mime_type", 128),
    file_ext: textValue(String(row.file_ext ?? "").toLowerCase(), "file_ext", 32),
    file_size: sizeText,
    business_module: nullableText(row.business_module, "business_module", 64),
    business_record_id: bigintText(row.business_record_id, "business_record_id", { nullable: true }),
    reference_status: referenceStatus,
    upload_user_id: bigintText(row.upload_user_id, "upload_user_id"),
    uploaded_at: utcIso(row.uploaded_at_utc, "uploaded_at"),
    created_by: bigintText(row.created_by, "created_by", { nullable: true }),
    created_at: utcIso(row.created_at_utc, "created_at"),
    updated_by: bigintText(row.updated_by, "updated_by", { nullable: true }),
    updated_at: utcIso(row.updated_at_utc, "updated_at"),
    deleted: deleted === 1,
    stored_name: storedName,
    local_path: binaryPath(storedName)
  };
}

export function validateUniqueAttachments(rows) {
  const ids = new Set();
  const paths = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new Error("Legacy attachments contain duplicate IDs");
    if (paths.has(row.storage_path)) throw new Error("Legacy attachments contain duplicate storage paths");
    ids.add(row.id);
    paths.add(row.storage_path);
  }
}

const sourceQuery = `
  SELECT id, original_name, stored_name, mime_type, file_ext, file_size,
         business_module, business_record_id, reference_status, upload_user_id,
         created_by, updated_by, deleted,
         CONVERT_TZ(uploaded_at, ?, '+00:00') AS uploaded_at_utc,
         CONVERT_TZ(created_at, ?, '+00:00') AS created_at_utc,
         CONVERT_TZ(updated_at, ?, '+00:00') AS updated_at_utc
  FROM attachments
  WHERE id > ?
  ORDER BY id ASC
  LIMIT ?`;

async function readAttachments(connection, sourceTimezone) {
  const rows = [];
  let cursor = "0";
  while (true) {
    const [batch] = await connection.execute(sourceQuery, [
      sourceTimezone,
      sourceTimezone,
      sourceTimezone,
      cursor,
      batchSize
    ]);
    const mapped = batch.map(mapLegacyAttachment);
    for (const attachment of mapped) {
      if (attachment.deleted) continue;
      let fileInfo;
      try {
        fileInfo = await stat(attachment.local_path);
      } catch {
        throw new Error("An active legacy attachment file is missing from backend/uploads/attachments");
      }
      if (fileInfo.size !== Number(attachment.file_size)) {
        throw new Error("An active legacy attachment file size differs from its MySQL metadata");
      }
    }
    rows.push(...mapped);
    if (rows.length > 100_000) throw new Error("Legacy attachments exceed the safe scan limit");
    if (batch.length < batchSize) break;
    cursor = mapped.at(-1).id;
  }
  validateUniqueAttachments(rows);
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
    typeof serviceRoleKey !== "string" ||
    !serviceRoleKey
  ) {
    throw new Error("This importer only accepts this project's local Supabase API and key");
  }
  return { apiUrl, serviceRoleKey };
}

function encodeStoragePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function objectUrl(target, path, access = "object") {
  const endpoint = access === "authenticated"
    ? `/storage/v1/object/authenticated/${bucket}/${encodeStoragePath(path)}`
    : `/storage/v1/object/${bucket}/${encodeStoragePath(path)}`;
  return `${target.apiUrl}${endpoint}`;
}

function serviceHeaders(target, contentType) {
  return {
    apikey: target.serviceRoleKey,
    Authorization: `Bearer ${target.serviceRoleKey}`,
    ...(contentType ? { "Content-Type": contentType } : {})
  };
}

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function existingObjectMatches(target, path, sourceBytes) {
  const response = await fetch(objectUrl(target, path, "authenticated"), {
    headers: serviceHeaders(target)
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error("Could not verify an existing local Storage object");
  const storedBytes = Buffer.from(await response.arrayBuffer());
  if (hash(storedBytes) !== hash(sourceBytes)) {
    throw new Error("A legacy storage path already exists with different content");
  }
  return true;
}

async function ensureLegacyObject(target, attachment, uploadedThisBatch) {
  const bytes = await readFile(attachment.local_path);
  if (bytes.length !== Number(attachment.file_size)) {
    throw new Error("A legacy attachment file changed after the read-only source scan");
  }
  if (await existingObjectMatches(target, attachment.storage_path, bytes)) return;

  const response = await fetch(objectUrl(target, attachment.storage_path), {
    method: "POST",
    headers: {
      ...serviceHeaders(target, attachment.mime_type),
      "x-upsert": "false",
      "cache-control": "3600"
    },
    body: bytes
  });
  if (!response.ok) {
    if (await existingObjectMatches(target, attachment.storage_path, bytes)) return;
    throw new Error(`Supabase Local rejected an attachment upload (${response.status})`);
  }
  uploadedThisBatch.push(attachment.storage_path);
}

async function removeNewObjects(target, paths) {
  if (paths.length === 0) return;
  await fetch(`${target.apiUrl}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: serviceHeaders(target, "application/json"),
    body: JSON.stringify({ prefixes: paths })
  }).catch(() => undefined);
}

async function importBatch(target, rows, apply) {
  const response = await fetch(`${target.apiUrl}/rest/v1/rpc/import_legacy_attachments`, {
    method: "POST",
    headers: serviceHeaders(target, "application/json"),
    body: JSON.stringify({
      p_rows: rows.map(({ stored_name: _storedName, local_path: _localPath, ...row }) => row),
      p_apply: apply
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object") {
    const code = result?.code ?? result?.error_code ?? "unknown";
    throw new Error(`Supabase rejected the attachment metadata import (${code})`);
  }
  for (const key of ["sourceCount", "alreadyPresentCount", "rowsToInsert", "insertedCount"]) {
    if (!Number.isSafeInteger(result[key]) || result[key] < 0) {
      throw new Error("Supabase returned invalid attachment import counts");
    }
  }
  return result;
}

async function runImport(target, rows, apply) {
  const totals = { sourceCount: 0, alreadyPresentCount: 0, rowsToInsert: 0, insertedCount: 0 };
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const preview = await importBatch(target, batch, false);
    if (preview.sourceCount !== batch.length) {
      throw new Error("Supabase counted an unexpected number of attachment rows");
    }
    if (apply && preview.rowsToInsert > 0) {
      const uploadedThisBatch = [];
      try {
        for (const row of batch) {
          if (!row.deleted) await ensureLegacyObject(target, row, uploadedThisBatch);
        }
        const applied = await importBatch(target, batch, true);
        totals.insertedCount += applied.insertedCount;
        if (applied.sourceCount !== batch.length || applied.rowsToInsert !== preview.rowsToInsert) {
          throw new Error("Attachment rows changed while the local import was running");
        }
      } catch (error) {
        await removeNewObjects(target, uploadedThisBatch);
        throw error;
      }
    }
    totals.sourceCount += preview.sourceCount;
    totals.alreadyPresentCount += preview.alreadyPresentCount;
    totals.rowsToInsert += preview.rowsToInsert;
  }
  if (totals.sourceCount !== rows.length) {
    throw new Error("Supabase counted an unexpected number of attachment rows");
  }
  return totals;
}

function usage() {
  return [
    "Read-only preview (default):",
    "  node scripts/migrate-attachments-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone>",
    "Transfer files and metadata to this project's local Supabase only:",
    "  node scripts/migrate-attachments-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <MySQL source timezone> --apply-local"
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

    const attachments = await readAttachments(connection, args.sourceTimezone);
    const preview = await runImport(target, attachments, false);
    const applied = args.applyLocal ? await runImport(target, attachments, true) : null;

    await connection.commit();
    process.stdout.write(`${JSON.stringify({
      mode: args.applyLocal ? "apply-local" : "preview-only",
      sourceDatabase,
      sourceHost,
      target: "local-supabase",
      attachments: {
        sourceRows: attachments.length,
        activeFiles: attachments.filter(row => !row.deleted).length,
        alreadyPresentRows: preview.alreadyPresentCount,
        rowsToInsert: preview.rowsToInsert,
        insertedRows: applied?.insertedCount ?? 0
      }
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
    process.stderr.write(`${error instanceof Error ? error.message : "Attachment import failed"}\n`);
    process.exitCode = 1;
  });
}
