import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(testDirectory, "..");
const repositoryDirectory = resolve(backendDirectory, "..");
const envPath = join(testDirectory, ".env");
const backendEnvPath = join(backendDirectory, ".env");
const composePath = join(testDirectory, "compose.yaml");
const projectName = "fullstack-admin-template-test-db";
const expectedDatabase = "fullstack_admin_template_test";
const expectedUser = "template_test";

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function fileExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function linkBackendEnv() {
  if (fileExists(backendEnvPath)) {
    console.log("Existing backend/.env was left unchanged.");
    return;
  }
  symlinkSync("test-db/.env", backendEnvPath);
  console.log("Linked backend/.env to the dedicated test configuration.");
}

function prepare() {
  if (fileExists(envPath)) {
    console.log("Existing backend/test-db/.env was left unchanged.");
    linkBackendEnv();
    return;
  }

  const values = [
    "PORT=3000",
    `JWT_SECRET=${randomSecret()}`,
    "ACCESS_TOKEN_TTL_MINUTES=30",
    "REFRESH_TOKEN_TTL_DAYS=7",
    "MYSQL_HOST=127.0.0.1",
    "MYSQL_PORT=3307",
    `MYSQL_USER=${expectedUser}`,
    `MYSQL_PASSWORD=${randomSecret()}`,
    `MYSQL_DATABASE=${expectedDatabase}`,
    `MYSQL_TEST_ROOT_PASSWORD=${randomSecret()}`,
    "SUPABASE_URL=http://127.0.0.1:54321",
    "SUPABASE_PUBLISHABLE_KEY=",
    "LOG_LEVEL=debug"
  ];
  writeFileSync(envPath, `${values.join("\n")}\n`, { flag: "wx", mode: 0o600 });
  console.log("Created the ignored backend/test-db/.env with random local credentials.");
  linkBackendEnv();
}

function config() {
  if (!existsSync(envPath)) throw new Error("Run setup.mjs prepare first");
  const values = dotenv.parse(readFileSync(envPath));
  if (
    values.MYSQL_DATABASE !== expectedDatabase ||
    values.MYSQL_USER !== expectedUser ||
    values.MYSQL_HOST !== "127.0.0.1" ||
    !/^\d{2,5}$/.test(values.MYSQL_PORT ?? "") ||
    !values.MYSQL_PASSWORD ||
    !values.MYSQL_TEST_ROOT_PASSWORD
  ) {
    throw new Error("Test configuration must target the dedicated loopback database and user");
  }
  return values;
}

function run(command, args, cwd = repositoryDirectory) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" }
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} operation failed (exit ${result.status ?? "unavailable"})`);
  }
  return result.stdout.trim();
}

function compose(args) {
  return run("docker", ["compose", "--env-file", envPath, "-f", composePath, ...args]);
}

function confirmContainer(values) {
  const containerId = compose(["ps", "-q", "mysql"]);
  if (!containerId) throw new Error("This project's test MySQL container is not running");
  const owner = run("docker", [
    "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', containerId
  ]);
  if (owner !== projectName) throw new Error("MySQL container ownership does not match this project");
  const ports = run("docker", ["port", containerId, "3306/tcp"]);
  if (!ports.split("\n").includes(`127.0.0.1:${values.MYSQL_PORT}`)) {
    throw new Error("MySQL container is not bound to the configured loopback port");
  }
}

function up() {
  const values = config();
  compose(["up", "-d", "--wait"]);
  confirmContainer(values);
  console.log(`Dedicated MySQL container is healthy on 127.0.0.1:${values.MYSQL_PORT}.`);
}

async function connection(values) {
  return mysql.createConnection({
    host: values.MYSQL_HOST,
    port: Number(values.MYSQL_PORT),
    user: values.MYSQL_USER,
    password: values.MYSQL_PASSWORD,
    database: values.MYSQL_DATABASE,
    charset: "utf8mb4",
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    timezone: "+08:00",
    connectTimeout: 5000
  });
}

async function inspectDatabase(client, values) {
  const [identityRows] = await client.query(
    "SELECT DATABASE() AS database_name, @@global.time_zone AS server_timezone"
  );
  if (
    identityRows[0]?.database_name !== expectedDatabase ||
    identityRows[0]?.server_timezone !== "+08:00"
  ) {
    throw new Error("Database name or timezone does not match the dedicated test target");
  }
  const [conversionRows] = await client.query(
    "SELECT CONVERT_TZ('2000-01-01 00:00:00', '+08:00', '+00:00') AS converted_utc"
  );
  if (conversionRows[0]?.converted_utc !== "1999-12-31 16:00:00") {
    throw new Error("MySQL timezone conversion does not match the test source timezone");
  }
  const [tableRows] = await client.execute(
    "SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'",
    [values.MYSQL_DATABASE]
  );
  return tableRows.map(row => row.table_name);
}

async function initialize() {
  const values = config();
  confirmContainer(values);
  const client = await connection(values);
  try {
    const tables = await inspectDatabase(client, values);
    if (tables.length !== 0) {
      throw new Error("The dedicated test database is nonempty; initialization refused");
    }
    const schema = readFileSync(join(backendDirectory, "db", "schema.sql"), "utf8");
    const seed = readFileSync(join(backendDirectory, "db", "seed.sql"), "utf8");
    try {
      await client.query(schema);
      await client.query(seed);
    } catch (error) {
      throw new Error(`Schema or Seed import stopped (${error?.code ?? "unknown"}); inspect this dedicated database before retrying`);
    }
    const [userRows] = await client.query("SELECT COUNT(*) AS total FROM users");
    const [roleRows] = await client.query("SELECT COUNT(*) AS total FROM roles");
    const [menuRows] = await client.query("SELECT COUNT(*) AS total FROM menus");
    if (
      Number(userRows[0]?.total) !== 3 ||
      Number(roleRows[0]?.total) !== 3 ||
      Number(menuRows[0]?.total) < 19
    ) {
      throw new Error("Seed counts differ from the expected template fixtures");
    }
    console.log(`Initialized ${expectedDatabase}: 3 users, 3 roles, ${menuRows[0].total} menus.`);
  } finally {
    await client.end();
  }
}

async function status() {
  const values = config();
  confirmContainer(values);
  const client = await connection(values);
  try {
    const tables = await inspectDatabase(client, values);
    const requiredTables = ["users", "roles", "menus", "messages"];
    if (requiredTables.every(table => tables.includes(table))) {
      const [rows] = await client.query(
        "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM roles) AS roles, (SELECT COUNT(*) FROM menus) AS menus, (SELECT COUNT(*) FROM messages) AS messages"
      );
      console.log(`${expectedDatabase}: ${tables.length} tables, ${rows[0].users} users, ${rows[0].roles} roles, ${rows[0].menus} menus, ${rows[0].messages} messages; timezone +08:00.`);
    } else if (tables.length === 0) {
      console.log(`${expectedDatabase} exists and is empty; run setup.mjs init.`);
    } else {
      throw new Error("The dedicated test database contains an incomplete schema");
    }
  } finally {
    await client.end();
  }
}

async function preflight() {
  const values = config();
  confirmContainer(values);
  const client = await connection(values);
  try {
    await client.query("START TRANSACTION READ ONLY");
    const [authResults] = await client.query(readFileSync(
      join(backendDirectory, "db", "preflight-auth-accounts.sql"), "utf8"
    ));
    const [messageResults] = await client.query(readFileSync(
      join(backendDirectory, "db", "preflight-messages.sql"), "utf8"
    ));
    if (authResults.length !== 7 || messageResults.length !== 4) {
      throw new Error("Preflight result-set count changed; review the SQL before using this report");
    }
    const accountIssues = authResults.slice(0, 6).map(rows => rows.length);
    const messageInventory = messageResults[1][0];
    const missingProfiles = messageResults[3][0];
    console.log(JSON.stringify({
      database: expectedDatabase,
      sourceTimezone: "+08:00",
      accountCandidates: authResults[6].length,
      accountIssueRowsByCheck: accountIssues,
      messages: Number(messageInventory.total_messages),
      messageTypes: messageResults[2].length,
      missingReceiverProfiles: Number(missingProfiles.missing_receiver_profiles),
      missingSenderProfiles: Number(missingProfiles.missing_sender_profiles),
      invalidReadStatusRows: Number(messageInventory.invalid_read_status_rows)
    }));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

function syncSupabaseKey() {
  const values = config();
  const cli = join(repositoryDirectory, "frontend", "node_modules", ".bin", "supabase");
  if (!existsSync(cli)) throw new Error("Install frontend dependencies before syncing Supabase Local");
  const raw = run(cli, ["--workdir", repositoryDirectory, "status", "--output", "json"]);
  let local;
  try {
    local = JSON.parse(raw);
  } catch {
    throw new Error("Supabase Local status could not be parsed");
  }
  if (
    !/^http:\/\/(127\.0\.0\.1|localhost):54321$/.test(local.API_URL ?? "") ||
    typeof local.PUBLISHABLE_KEY !== "string" ||
    !local.PUBLISHABLE_KEY
  ) {
    throw new Error("Only this project's local Supabase publishable key is accepted");
  }
  const current = readFileSync(envPath, "utf8");
  const next = current.replace(/^SUPABASE_PUBLISHABLE_KEY=.*$/m,
    `SUPABASE_PUBLISHABLE_KEY=${local.PUBLISHABLE_KEY}`);
  if (next === current && !values.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("The test environment has no Supabase publishable key field");
  }
  writeFileSync(envPath, next, { mode: 0o600 });
  console.log("Synced the local Supabase publishable key into the ignored test environment.");
}

const action = process.argv[2];
try {
  switch (action) {
    case "prepare":
      prepare();
      break;
    case "up":
      up();
      break;
    case "init":
      await initialize();
      break;
    case "status":
      await status();
      break;
    case "preflight":
      await preflight();
      break;
    case "sync-supabase-key":
      syncSupabaseKey();
      break;
    default:
      console.log("Usage: node backend/test-db/setup.mjs <prepare|up|init|status|preflight|sync-supabase-key>");
      process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Dedicated test DB setup failed");
  process.exitCode = 1;
}
