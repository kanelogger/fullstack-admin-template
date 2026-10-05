import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(projectRoot, "frontend");
const registryPath = path.join(frontendRoot, "src/features/menus/menu-routes.registry.ts");
const contractPath = path.join(
  projectRoot,
  "supabase/functions/_shared/contracts/src/menu-management.ts"
);
const permissionPath = path.join(
  projectRoot,
  "supabase/functions/_shared/contracts/src/permissions.ts"
);
const seedPath = path.join(projectRoot, "supabase/seed.sql");
const migrationsPath = path.join(projectRoot, "supabase/migrations");

function capture(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `Could not read ${label}`);
  return match[1];
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

const [registrySource, contractSource, permissionSource, seedSource, migrationNames] = await Promise.all([
  readFile(registryPath, "utf8"),
  readFile(contractPath, "utf8"),
  readFile(permissionPath, "utf8"),
  readFile(seedPath, "utf8"),
  readdir(migrationsPath)
]);
const migrationSources = await Promise.all(migrationNames
  .filter(name => name.endsWith(".sql"))
  .map(name => readFile(path.join(migrationsPath, name), "utf8")));

const contractKeysBlock = capture(
  contractSource,
  /ManagedRouteKeySchema\s*=\s*z\.enum\(\[([\s\S]*?)\]\);/,
  "ManagedRouteKeySchema"
);
const contractKeys = [...contractKeysBlock.matchAll(/"([^"]+)"/g)].map(match => match[1]);
const registryBlock = capture(
  registrySource,
  /export const menuRouteRegistry\s*=\s*\{([\s\S]*?)\}\s*satisfies/,
  "menuRouteRegistry"
);
const registryEntries = [...registryBlock.matchAll(
  /^\s*"([^"]+)":\s*\(\)\s*=>\s*import\("([^"]+)"\)/gm
)].map(match => ({ routeKey: match[1], specifier: match[2] }));
const metadataBlock = capture(
  registrySource,
  /export const registeredMenuRoutes:[\s\S]*?=\s*\[([\s\S]*?)\];/,
  "registeredMenuRoutes"
);
const metadataEntries = [...metadataBlock.matchAll(
  /routeKey:\s*"([^"]+)"[^\n]*defaultPath:\s*"([^"]+)"[^\n]*requiredPermissionKey:\s*"([^"]+)"/g
)].map(match => ({ routeKey: match[1], path: match[2], permission: match[3] }));
const permissionPattern = new RegExp(capture(
  permissionSource,
  /PermissionKeySchema\s*=\s*z\s*\.string\(\)\s*\.regex\(\s*\/([^/]+)\//,
  "PermissionKeySchema"
));
const catalogPermissionKeys = new Set();
for (const sql of [seedSource, ...migrationSources]) {
  for (const insert of sql.matchAll(
    /insert\s+into\s+public\.permission_catalog\s*\(\s*permission_key\s*,\s*description\s*\)\s*values([\s\S]*?)on\s+conflict/gi
  )) {
    for (const row of insert[1].matchAll(/\(\s*'([^']+)'\s*,/g)) {
      catalogPermissionKeys.add(row[1]);
    }
  }
}

assert.equal(new Set(contractKeys).size, contractKeys.length, "Contract RouteKeys must be unique");
assert.equal(new Set(registryEntries.map(entry => entry.routeKey)).size, registryEntries.length,
  "Registry RouteKeys must be unique");
assert.deepEqual(
  sorted(registryEntries.map(entry => entry.routeKey)),
  sorted(contractKeys),
  "Every contract RouteKey must have exactly one frontend component"
);
assert.equal(new Set(metadataEntries.map(entry => entry.routeKey)).size, metadataEntries.length,
  "Menu metadata RouteKeys must be unique");
assert.deepEqual(
  sorted(metadataEntries.map(entry => entry.routeKey)),
  sorted(contractKeys),
  "Every RouteKey must have exactly one menu metadata entry"
);
assert.equal(new Set(metadataEntries.map(entry => entry.path)).size, metadataEntries.length,
  "Default menu paths must be unique");

for (const entry of metadataEntries) {
  assert.match(entry.permission, permissionPattern, `Invalid permission key for ${entry.routeKey}`);
  assert.ok(
    catalogPermissionKeys.has(entry.permission),
    `Route ${entry.routeKey} requires permission ${entry.permission}, which is absent from seed and migration permission catalogs`
  );
}

for (const { routeKey, specifier } of registryEntries) {
  assert.ok(specifier.startsWith("@/"), `Route ${routeKey} must use the frontend alias`);
  const targetPath = path.resolve(frontendRoot, "src", specifier.slice(2));
  await access(targetPath);
  const relativeTarget = path.relative(projectRoot, targetPath);
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--no-index", "--", relativeTarget], {
      cwd: projectRoot,
      stdio: "ignore"
    });
    throw new Error(`Route ${routeKey} points to an ignored file: ${relativeTarget}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`Route ${routeKey}`)) throw error;
    if (error?.status !== 1) throw error;
  }

  if (process.env.CI === "true") {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", relativeTarget], {
      cwd: projectRoot,
      stdio: "ignore"
    });
  }
}

console.log(`Checked ${registryEntries.length} route keys, permissions, metadata entries and tracked component imports.`);
