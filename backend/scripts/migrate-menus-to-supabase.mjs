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
const testFixtureDatabase = "fullstack_admin_template_test";

const routeKeyByComponent = new Map([
  ["/welcome/index", "dashboard.overview"],
  ["/profile/index", "account.profile"],
  ["/profile/change-password/index", "account.change-password"],
  ["/operation/message/index", "communication.messages"],
  ["/operation/attachment/index", "operation.attachments"],
  ["/system/user/index", "administration.users"],
  ["/system/role/index", "administration.roles"],
  ["/system/menu/index", "administration.menus"],
  ["/system/dept/index", "administration.departments"],
  ["/system/post/index", "administration.posts"],
  ["/system/dict/index", "administration.dictionaries"],
  ["/system/config/index", "administration.configurations"],
  ["/log/login-log/index", "audit.login-logs"],
  ["/log/operation-log/index", "audit.operation-logs"],
  ["/log/exception-log/index", "audit.exception-logs"]
]);

const requiredPermissionByRouteKey = new Map([
  ["dashboard.overview", "dashboard.overview.read"],
  ["account.profile", "identity.profile.read"],
  ["account.change-password", "identity.profile.read"],
  ["communication.messages", "communication.messages.read"],
  ["operation.attachments", "files.attachments.read"],
  ["administration.users", "administration.users.read"],
  ["administration.roles", "administration.roles.read"],
  ["administration.menus", "administration.menus.read"],
  ["administration.departments", "organization.departments.read"],
  ["administration.posts", "organization.posts.read"],
  ["administration.dictionaries", "configuration.dictionaries.read"],
  ["administration.configurations", "configuration.system.read"],
  ["audit.login-logs", "audit.logs.read"],
  ["audit.operation-logs", "audit.logs.read"],
  ["audit.exception-logs", "audit.logs.read"]
]);

function positiveBigintText(value, field, nullable = false) {
  if ((value === null || value === undefined || value === "") && nullable) return null;
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) throw new Error(`Legacy menu ${field} is not a positive BIGINT`);
  if (BigInt(text) > maxPostgresBigint) throw new Error(`Legacy menu ${field} exceeds PostgreSQL BIGINT`);
  return text;
}

function parseMeta(value) {
  if (value === null || value === undefined || value === "") return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") throw new Error("Legacy menu metadata is invalid");
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Invalid optional metadata falls back to the source menu title.
  }
  return {};
}

export function mapLegacyMenuRow(row) {
  const status = Number(row.status);
  const visible = Number(row.visible);
  if ((status !== 0 && status !== 1) || (visible !== 0 && visible !== 1)) {
    throw new Error("Legacy menu status and visibility must be 0 or 1");
  }
  const component = row.component_path === null || row.component_path === undefined
    ? null
    : String(row.component_path).trim();
  const kind = component === null || component === "" ? "group" : "route";
  const routeKey = kind === "route" ? routeKeyByComponent.get(component) : null;
  if (kind === "route" && !routeKey) {
    throw new Error(`Legacy component path is not in the local route registry: ${component}`);
  }

  const meta = parseMeta(row.meta_json);
  const title = typeof meta.title === "string" && meta.title.trim()
    ? meta.title.trim()
    : String(row.menu_name ?? "").trim();
  if (!title || title.length > 128) throw new Error("Legacy menu title is empty or too long");

  const sortOrder = Number(row.sort_order);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000) {
    throw new Error("Legacy menu sort_order is outside the supported range");
  }

  const path = String(row.route_path ?? "").trim();
  if (!/^(?:\/|(?:\/[a-zA-Z0-9_:-]+)+\/?$)/.test(path) || path.length > 255) {
    throw new Error("Legacy menu path is invalid");
  }

  const sourceVisible = Boolean(visible) && meta.showLink !== false;
  return {
    id: positiveBigintText(row.id, "id"),
    parent_id: positiveBigintText(row.parent_id, "parent_id", true),
    kind,
    route_key: routeKey ?? null,
    path,
    title,
    icon: row.icon === null || row.icon === undefined || String(row.icon).trim() === ""
      ? null
      : String(row.icon).trim(),
    sort_order: sortOrder,
    is_visible: sourceVisible,
    is_active: status === 1,
    required_permission_key: routeKey ? requiredPermissionByRouteKey.get(routeKey) ?? null : null
  };
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} operation failed (exit ${result.status ?? "unavailable"})`);
  }
  return result.stdout.trim();
}

function getLocalSupabaseCredentials() {
  let status;
  try {
    status = JSON.parse(run(supabaseCli, ["--workdir", repositoryDirectory, "status", "--output", "json"], frontendDirectory));
  } catch {
    throw new Error("This command requires this project's Supabase Local stack");
  }
  const apiUrl = status.API_URL ?? status.api_url;
  const serviceRoleKey = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? status.SECRET_KEY;
  if (
    typeof apiUrl !== "string" ||
    !/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(apiUrl) ||
    typeof serviceRoleKey !== "string" || !serviceRoleKey
  ) {
    throw new Error("This importer only accepts this project's local Supabase API");
  }
  return { apiUrl, serviceRoleKey };
}

async function targetRequest(target, path, body) {
  const response = await fetch(new URL(path, target.apiUrl), {
    method: "POST",
    headers: {
      apikey: target.serviceRoleKey,
      Authorization: `Bearer ${target.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result?.code ?? result?.error_code ?? "unknown";
    throw new Error(`Local Supabase rejected the menu import (${code})`);
  }
  return result;
}

async function loadLegacyMenus(connection) {
  const [rows] = await connection.execute(`
    SELECT
      id,
      parent_id,
      menu_name,
      icon,
      sort_order,
      route_path,
      component_path,
      visible,
      status,
      meta_json
    FROM menus
    WHERE deleted = 0
    ORDER BY id ASC`);
  return rows;
}

function validateSourceMenus(rows) {
  const mapped = rows.map(mapLegacyMenuRow);
  const ids = new Set();
  const routeKeys = new Set();
  const paths = new Set();
  const sourceIds = new Set(mapped.map(row => row.id));

  for (const row of mapped) {
    if (ids.has(row.id)) throw new Error("Legacy menu source has duplicate IDs");
    ids.add(row.id);
    const normalizedPath = row.path.toLowerCase();
    if (paths.has(normalizedPath)) throw new Error("Legacy menu source has duplicate paths");
    paths.add(normalizedPath);
    if (row.route_key) {
      if (routeKeys.has(row.route_key)) throw new Error("Legacy menu source maps multiple rows to one RouteKey");
      routeKeys.add(row.route_key);
    }
    if (row.parent_id && !sourceIds.has(row.parent_id)) {
      throw new Error("Legacy menu source references a missing parent");
    }
  }

  return mapped;
}

function parseArgs(argv) {
  const result = { applyLocal: false, confirmDatabase: "", allowTestFixturesOnly: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply-local") result.applyLocal = true;
    else if (argument === "--allow-test-fixtures-only") result.allowTestFixturesOnly = true;
    else if (argument === "--confirm-source-database") result.confirmDatabase = argv[++index] ?? "";
    else if (argument.startsWith("--confirm-source-database=")) result.confirmDatabase = argument.split("=", 2)[1] ?? "";
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  return result;
}

function usage() {
  return [
    "Read-only preview (default):",
    "  node scripts/migrate-menus-to-supabase.mjs --confirm-source-database <MYSQL_DATABASE>",
    "Apply the dedicated synthetic test fixture to this project's local Supabase:",
    "  node scripts/migrate-menus-to-supabase.mjs --confirm-source-database fullstack_admin_template_test --apply-local --allow-test-fixtures-only"
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.confirmDatabase) throw new Error("Confirm the exact MySQL source database before preview");
  if (args.allowTestFixturesOnly && args.confirmDatabase !== testFixtureDatabase) {
    throw new Error("--allow-test-fixtures-only is restricted to the dedicated test database");
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
  if (sourceDatabase !== args.confirmDatabase) {
    throw new Error("The confirmed source database does not match backend/.env");
  }
  if (!process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
    throw new Error("MySQL source credentials are missing; no connection was attempted");
  }
  if (args.applyLocal && sourceDatabase === testFixtureDatabase && !args.allowTestFixturesOnly) {
    throw new Error("Test fixture menu imports require --allow-test-fixtures-only");
  }
  if (args.applyLocal && sourceDatabase !== testFixtureDatabase && args.allowTestFixturesOnly) {
    throw new Error("--allow-test-fixtures-only is restricted to this repository's test database");
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
    dateStrings: true,
    timezone: "+00:00"
  });

  try {
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const rows = validateSourceMenus(await loadLegacyMenus(connection));
    const preview = await targetRequest(target, "/rest/v1/rpc/import_legacy_menus", {
      p_rows: rows,
      p_apply: false
    });
    let applied = null;
    if (args.applyLocal) {
      applied = await targetRequest(target, "/rest/v1/rpc/import_legacy_menus", {
        p_rows: rows,
        p_apply: true
      });
    }
    await connection.commit();
    process.stdout.write(`${JSON.stringify({
      mode: args.applyLocal ? "apply-local" : "preview-only",
      sourceDatabase,
      sourceHost,
      sourceMenus: rows.length,
      groupMenus: rows.filter(row => row.kind === "group").length,
      routeMenus: rows.filter(row => row.kind === "route").length,
      routesByPermission: Object.fromEntries(
        [...new Set(rows.map(row => row.required_permission_key).filter(Boolean))]
          .map(permission => [permission, rows.filter(row => row.required_permission_key === permission).length])
      ),
      preview,
      applied,
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
    process.stderr.write(`${error instanceof Error ? error.message : "Menu import failed"}\n`);
    process.exitCode = 1;
  });
}
