import { randomUUID } from "node:crypto";
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
const maxLegacyBridgeId = BigInt(Number.MAX_SAFE_INTEGER);
const batchSize = 100;
const testFixtureDatabase = "fullstack_admin_template_test";

function parseArgs(argv) {
  const result = {
    applyLocal: false,
    confirmDatabase: "",
    sourceTimezone: "",
    confirmVerifiedEmails: false,
    allowTestFixturesOnly: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply-local") result.applyLocal = true;
    else if (argument === "--confirm-verified-emails") result.confirmVerifiedEmails = true;
    else if (argument === "--allow-test-fixtures-only") result.allowTestFixturesOnly = true;
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
  const integer = BigInt(text);
  if (integer > maxPostgresBigint) throw new Error(`Legacy ${field} exceeds PostgreSQL BIGINT`);
  if (field === "id" && integer > maxLegacyBridgeId) {
    throw new Error("Legacy business ID exceeds the active Fastify number range");
  }
  return text;
}

function normalizeRoleCodes(value) {
  if (value === null || value === undefined || value === "") return [];
  return [...new Set(String(value).split(",").map(role => role.trim()).filter(Boolean))];
}

function normalizeUtc(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Legacy ${field} could not be converted to UTC`);
  }
  let normalized = value.trim().replace(" ", "T");
  normalized = normalized.replace(/\.(\d{3})\d+$/, ".$1");
  const date = new Date(normalized.endsWith("Z") ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Legacy ${field} could not be converted to UTC`);
  return date.toISOString();
}

export function mapLegacyAccountRow(row, roleIdByCode) {
  const status = Number(row.status);
  if (status !== 0 && status !== 1) throw new Error("Legacy user status must be 0 or 1");

  const loginName = String(row.login_name ?? "").trim();
  const userCode = String(row.user_code ?? "").trim();
  const displayName = String(row.display_name ?? "").trim();
  const email = String(row.email ?? "").trim().toLowerCase();
  if (!loginName || loginName.length > 64) throw new Error("Legacy login_name is empty or too long");
  if (!userCode || userCode.length > 64) throw new Error("Legacy user_code is empty or too long");
  if (!displayName || displayName.length > 128) throw new Error("Legacy display_name is empty or too long");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error("Legacy email is missing or invalid");
  }

  const roleCodes = normalizeRoleCodes(row.role_codes);
  const roleIds = roleCodes.map(code => {
    const id = roleIdByCode.get(code);
    if (!id) throw new Error(`Legacy role ${code} has no active Supabase mapping`);
    return id;
  });

  const phone = row.phone === null || row.phone === undefined || String(row.phone).trim() === ""
    ? null
    : String(row.phone).trim();
  if (phone && phone.length > 32) throw new Error("Legacy phone exceeds the Supabase limit");

  return {
    id: positiveBigintText(row.id, "id"),
    user_code: userCode,
    login_name: loginName,
    display_name: displayName,
    email,
    phone,
    department_id: positiveBigintText(row.department_id, "department_id", true),
    post_id: positiveBigintText(row.post_id, "post_id", true),
    is_active: status === 1,
    role_codes: roleCodes,
    role_ids: roleIds,
    created_at: normalizeUtc(row.created_at_utc, "created_at"),
    updated_at: normalizeUtc(row.updated_at_utc, "updated_at")
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
  const outputText = run(supabaseCli, ["--workdir", repositoryDirectory, "status", "--output", "json"], frontendDirectory);
  let output;
  try {
    output = JSON.parse(outputText);
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
    throw new Error("This importer only accepts this project's local Supabase API");
  }
  return { apiUrl, serviceRoleKey };
}

async function apiRequest(target, path, { method = "GET", body } = {}) {
  const response = await fetch(new URL(path, target.apiUrl), {
    method,
    headers: {
      apikey: target.serviceRoleKey,
      Authorization: `Bearer ${target.serviceRoleKey}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result?.code ?? result?.error_code ?? "unknown";
    throw Object.assign(
      new Error(`Local Supabase API rejected an account migration operation (${code})`),
      { code }
    );
  }
  return result;
}

async function listAuthUsers(target) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await apiRequest(
      target,
      `/auth/v1/admin/users?page=${page}&per_page=1000`
    );
    const batch = Array.isArray(result?.users) ? result.users : [];
    users.push(...batch);
    if (batch.length < 1000) return users;
  }
  throw new Error("Auth user inventory exceeds the safe migration scan limit");
}

async function listTargetProfiles(target) {
  const profiles = [];
  for (let offset = 0; offset < 100_000; offset += 1000) {
    const batch = await apiRequest(
      target,
      `/rest/v1/user_management_read_model?select=id,auth_user_id,user_code,login_name,email,is_active,deleted_at&limit=1000&offset=${offset}`
    );
    if (!Array.isArray(batch)) throw new Error("Supabase user profile inventory is invalid");
    profiles.push(...batch);
    if (batch.length < 1000) return profiles;
  }
  throw new Error("Supabase profile inventory exceeds the safe migration scan limit");
}

async function listTargetRoles(target) {
  const roles = await apiRequest(
    target,
    "/rest/v1/user_management_role_options?select=id,code,name&limit=1000"
  );
  if (!Array.isArray(roles)) throw new Error("Supabase role inventory is invalid");
  return roles;
}

export function collectOrganizationReferenceIds(accounts) {
  return {
    departmentIds: [...new Set(accounts.map(account => account.department_id).filter(Boolean))],
    postIds: [...new Set(accounts.map(account => account.post_id).filter(Boolean))]
  };
}

async function assertTargetOrganizationReferences(target, accounts) {
  const { departmentIds, postIds } = collectOrganizationReferenceIds(accounts);
  if (!departmentIds.length && !postIds.length) return;
  for (let offset = 0; offset < Math.max(departmentIds.length, postIds.length); offset += 100) {
    try {
      await apiRequest(target, "/rest/v1/rpc/assert_legacy_organization_references", {
        method: "POST",
        body: {
          p_department_ids: departmentIds.slice(offset, offset + 100),
          p_post_ids: postIds.slice(offset, offset + 100)
        }
      });
    } catch (error) {
      if (error?.code !== "23503") throw error;
      throw new Error(
        "Import all referenced departments and posts before importing account profiles"
      );
    }
  }
}

async function createAuthUser(target, account, { emailConfirm }) {
  const response = await apiRequest(target, "/auth/v1/admin/users", {
    method: "POST",
    body: {
      email: account.email,
      password: `${randomUUID()}aA1!`,
      email_confirm: emailConfirm
    }
  });
  const user = response?.user ?? response;
  if (typeof user?.id !== "string") throw new Error("Auth did not return the created user ID");
  return user;
}

async function confirmAuthUser(target, userId) {
  const response = await apiRequest(target, `/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    body: { email_confirm: true }
  });
  const user = response?.user ?? response;
  if (user?.email_confirmed_at == null) {
    throw new Error("Auth email confirmation did not persist");
  }
}

async function cleanupCreatedAuthUsers(target, userIds) {
  for (const userId of userIds) {
    await apiRequest(target, `/auth/v1/admin/users/${userId}`, { method: "DELETE" })
      .catch(() => undefined);
  }
}

async function markForPasswordReset(target, account) {
  const marker = await apiRequest(target, "/rest/v1/rpc/mark_password_reset_requested", {
    method: "POST",
    body: { p_auth_user_id: account.authUserId }
  });
  if (marker !== true) return false;

  const mailResponse = await fetch(new URL("/auth/v1/recover", target.apiUrl), {
    method: "POST",
    headers: {
      apikey: target.serviceRoleKey,
      Authorization: `Bearer ${target.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: account.email,
      redirect_to: `${process.env.APP_ORIGIN ?? "http://127.0.0.1:8848"}/#/reset-password`
    })
  });
  if (!mailResponse.ok) return false;
  await mailResponse.arrayBuffer();
  return true;
}

function validateSourceAccounts(accounts, roleIdByCode) {
  const ids = new Set();
  const userCodes = new Set();
  const loginNames = new Set();
  const emails = new Set();
  const mapped = [];
  for (const row of accounts) {
    const account = mapLegacyAccountRow(row, roleIdByCode);
    const normalized = [account.id, account.user_code.toLowerCase(), account.login_name.toLowerCase(), account.email.toLowerCase()];
    const sets = [ids, userCodes, loginNames, emails];
    for (let index = 0; index < normalized.length; index += 1) {
      if (sets[index].has(normalized[index])) throw new Error("Legacy users contain duplicate IDs, user codes, login names, or emails");
      sets[index].add(normalized[index]);
    }
    mapped.push(account);
  }
  return mapped;
}

function inspectTargetConflicts(accounts, profiles, authUsers) {
  const profilesById = new Map(profiles.map(profile => [String(profile.id), profile]));
  const profilesByAuthId = new Map(profiles.filter(profile => profile.auth_user_id).map(profile => [profile.auth_user_id, profile]));
  const authByEmail = new Map(authUsers.filter(user => user.email).map(user => [user.email.toLowerCase(), user]));
  const targetEmails = new Map(profiles.map(profile => [String(profile.email).toLowerCase(), String(profile.id)]));
  const targetLoginNames = new Map(profiles.map(profile => [String(profile.login_name).toLowerCase(), String(profile.id)]));
  const targetUserCodes = new Map(profiles.filter(profile => profile.user_code).map(profile => [String(profile.user_code).toLowerCase(), String(profile.id)]));
  const plans = [];

  for (const account of accounts) {
    const profile = profilesById.get(account.id);
    for (const [map, value, label] of [
      [targetEmails, account.email.toLowerCase(), "email"],
      [targetLoginNames, account.login_name.toLowerCase(), "login_name"],
      [targetUserCodes, account.user_code.toLowerCase(), "user_code"]
    ]) {
      const conflictingId = map.get(value);
      if (conflictingId && conflictingId !== account.id) {
        throw new Error(`Target Supabase ${label} conflicts with another business profile`);
      }
    }

    let authUser = profile?.auth_user_id ? authUsers.find(user => user.id === profile.auth_user_id) : undefined;
    authUser ??= authByEmail.get(account.email.toLowerCase());
    if (authUser) {
      const otherProfile = profilesByAuthId.get(authUser.id);
      if (otherProfile && String(otherProfile.id) !== account.id) {
        throw new Error("Target Auth identity is already mapped to another business profile");
      }
      if (profile && profile.auth_user_id && profile.auth_user_id !== authUser.id) {
        throw new Error("Target profile is linked to a different Auth identity");
      }
    }

    if (profile && (
      profile.user_code !== account.user_code ||
      profile.login_name !== account.login_name ||
      profile.email?.toLowerCase() !== account.email.toLowerCase()
    )) {
      throw new Error("Target business ID conflicts with a different user profile");
    }
    plans.push({ account, profile, authUser, needsAuthUser: !authUser });
  }
  return plans;
}

async function getSupabaseCredentials() {
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
  if (status.status !== 0) throw new Error("This command requires this project's Supabase Local stack");
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
  ) throw new Error("This importer only accepts this project's local Supabase API");
  return { apiUrl, serviceRoleKey };
}

async function loadLegacyUsers(connection, timezone) {
  const [rows] = await connection.execute(`
    SELECT
      users.id,
      users.user_code,
      users.login_name,
      users.display_name,
      users.email,
      users.phone,
      users.dept_id AS department_id,
      users.post_id AS post_id,
      users.status,
      CONVERT_TZ(users.created_at, ?, '+00:00') AS created_at_utc,
      CONVERT_TZ(users.updated_at, ?, '+00:00') AS updated_at_utc,
      GROUP_CONCAT(DISTINCT CASE
        WHEN role.status = 1 AND role.deleted = 0 THEN role.role_code
        ELSE NULL
      END ORDER BY role.role_code SEPARATOR ',') AS role_codes
    FROM users
    LEFT JOIN user_roles AS user_role
      ON user_role.user_id = users.id AND user_role.deleted = 0
    LEFT JOIN roles AS role ON role.id = user_role.role_id
    WHERE users.deleted = 0
    GROUP BY users.id
    ORDER BY users.id ASC`, [timezone, timezone]);
  return rows;
}

function assertApplyAuthorization(args, sourceDatabase) {
  if (!args.applyLocal) return;
  if (!args.confirmDatabase || args.confirmDatabase !== sourceDatabase) {
    throw new Error("Pass --confirm-source-database with the exact MYSQL_DATABASE");
  }
  if (sourceDatabase === testFixtureDatabase) {
    if (!args.allowTestFixturesOnly) {
      throw new Error("Test fixture imports require --allow-test-fixtures-only");
    }
    if (args.confirmVerifiedEmails) {
      throw new Error("Do not use --confirm-verified-emails for the synthetic test fixture");
    }
    return;
  }
  if (args.allowTestFixturesOnly) {
    throw new Error("--allow-test-fixtures-only is restricted to this repository's dedicated test database");
  }
  if (!args.confirmVerifiedEmails) {
    throw new Error("Confirm email ownership before applying Auth accounts with --confirm-verified-emails");
  }
}

function usage() {
  return [
    "Read-only preview (default):",
    "  node scripts/migrate-auth-accounts.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <timezone>",
    "Apply the dedicated synthetic test fixture to this project's local Supabase:",
    "  node scripts/migrate-auth-accounts.mjs --confirm-source-database fullstack_admin_template_test --source-timezone +08:00 --apply-local --allow-test-fixtures-only",
    "Apply real accounts only after verifying every email is owned and verified:",
    "  node scripts/migrate-auth-accounts.mjs --confirm-source-database <MYSQL_DATABASE> --source-timezone <timezone> --apply-local --confirm-verified-emails"
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.confirmDatabase || !args.sourceTimezone) {
    throw new Error("Pass the exact source database name and timezone for preflight");
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
  assertApplyAuthorization(args, sourceDatabase);

  const rolesMap = await getSupabaseCredentials();
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
  const createdAuthUserIds = [];

  try {
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const [timezoneRows] = await connection.execute(
      "SELECT CONVERT_TZ('2000-01-01 00:00:00', ?, '+00:00') AS converted",
      [args.sourceTimezone]
    );
    if (!timezoneRows[0]?.converted) throw new Error("MySQL could not resolve the declared timezone");

    const sourceRows = await loadLegacyUsers(connection, args.sourceTimezone);
    const [targetRoleOptions, targetProfiles, authUsers] = await Promise.all([
      apiRequest(rolesMap, "/rest/v1/user_management_role_options?select=id,code,name&limit=1000"),
      listTargetProfiles(rolesMap),
      listAuthUsers(rolesMap)
    ]);
    if (!Array.isArray(targetRoleOptions)) throw new Error("Supabase role inventory is invalid");
    const roleIdByCode = new Map(targetRoleOptions.map(role => [role.code, String(role.id)]));
    const accounts = validateSourceAccounts(sourceRows, roleIdByCode);
    await assertTargetOrganizationReferences(rolesMap, accounts);
    const plans = inspectTargetConflicts(accounts, targetProfiles, authUsers);
    const report = {
      mode: args.applyLocal ? "apply-local" : "preview-only",
      sourceDatabase,
      sourceTimezone: args.sourceTimezone,
      sourceAccounts: accounts.length,
      activeAccounts: accounts.filter(account => account.is_active).length,
      inactiveAccounts: accounts.filter(account => !account.is_active).length,
      roleAssignments: accounts.reduce((total, account) => total + account.role_ids.length, 0),
      existingBusinessProfiles: plans.filter(plan => plan.profile).length,
      authUsersToCreate: plans.filter(plan => plan.needsAuthUser).length,
      emailOwnershipEvidence: args.allowTestFixturesOnly
        ? "synthetic local fixture; Auth emails will be confirmed for Mailpit-only testing"
        : args.confirmVerifiedEmails
          ? "operator-confirmed verified emails"
          : "not verifiable from MySQL; apply requires --confirm-verified-emails",
      target: "local-supabase"
    };

    if (!args.applyLocal) {
      await connection.rollback();
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    for (const plan of plans) {
      plan.notifyForPasswordReset = plan.account.is_active &&
        (!plan.profile || !plan.profile.auth_user_id);
      if (plan.authUser) {
        if (plan.authUser.email_confirmed_at == null) {
          if (!args.allowTestFixturesOnly && !args.confirmVerifiedEmails) {
            throw new Error("An existing Auth email is unconfirmed; verify ownership before import");
          }
          await confirmAuthUser(rolesMap, plan.authUser.id);
        }
        plan.authUserId = plan.authUser.id;
      } else {
        const authUser = await createAuthUser(rolesMap, plan.account, {
          emailConfirm: true
        });
        plan.authUserId = authUser.id;
        createdAuthUserIds.push(authUser.id);
      }
    }

    const importRows = plans.map(({ account, authUserId }) => ({
      ...account,
      auth_user_id: authUserId
    }));
    const preview = await apiRequest(rolesMap, "/rest/v1/rpc/import_legacy_user_profiles", {
      method: "POST",
      body: { p_rows: importRows, p_apply: false }
    });
    const applied = await apiRequest(rolesMap, "/rest/v1/rpc/import_legacy_user_profiles", {
      method: "POST",
      body: { p_rows: importRows, p_apply: true }
    });

    const resetMailResults = [];
    for (const plan of plans) {
      if (!plan.notifyForPasswordReset) continue;
      const sent = await markForPasswordReset(rolesMap, {
        authUserId: plan.authUserId,
        email: plan.account.email
      }).catch(() => false);
      resetMailResults.push(sent);
    }
    await connection.commit();

    process.stdout.write(`${JSON.stringify({
      ...report,
      preview,
      applied,
      newAuthUsers: createdAuthUserIds.length,
      resetEmailsSent: resetMailResults.filter(Boolean).length,
      resetEmailFailures: resetMailResults.filter(sent => !sent).length
    }, null, 2)}\n`);
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    if (createdAuthUserIds.length) {
      for (const userId of createdAuthUserIds) {
        await apiRequest(rolesMap, `/rest/v1/rpc/rollback_managed_user_create`, {
          method: "POST",
          body: { p_auth_user_id: userId }
        }).catch(() => undefined);
      }
      await cleanupCreatedAuthUsers(rolesMap, createdAuthUserIds);
    }
    throw error;
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Auth account import failed"}\n`);
    process.exitCode = 1;
  });
}
