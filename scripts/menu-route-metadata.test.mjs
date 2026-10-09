import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseMenuRouteRegistry, parseRegisteredMenuRoutes } from "./menu-route-metadata.mjs";

const registryPath = fileURLToPath(
  new URL("../frontend/src/features/menus/menu-routes.registry.ts", import.meta.url)
);

const singleLineSource = `export const registeredMenuRoutes: ReadonlyArray<{
  routeKey: RegisteredMenuRouteKey;
}> = [
  { routeKey: "dashboard.overview", label: "首页", defaultPath: "/welcome", requiredPermissionKey: "dashboard.overview.read" },
  { routeKey: "account.profile", label: "个人资料", defaultPath: "/profile/info", requiredPermissionKey: "account.profile.read" }
];
`;

const wrappedSource = `export const registeredMenuRoutes: ReadonlyArray<{
  routeKey: RegisteredMenuRouteKey;
}> = [
  {
    routeKey: "dashboard.overview",
    label: "首页",
    defaultPath: "/welcome",
    requiredPermissionKey: "dashboard.overview.read"
  },
  {
    routeKey: "account.profile",
    label: "个人资料",
    defaultPath: "/profile/info",
    requiredPermissionKey: "account.profile.read"
  }
];
`;

test("registered menu metadata parsing ignores line wrapping and indentation", () => {
  const expected = [
    {
      routeKey: "dashboard.overview",
      label: "首页",
      defaultPath: "/welcome",
      requiredPermissionKey: "dashboard.overview.read"
    },
    {
      routeKey: "account.profile",
      label: "个人资料",
      defaultPath: "/profile/info",
      requiredPermissionKey: "account.profile.read"
    }
  ];
  assert.deepEqual(parseRegisteredMenuRoutes(singleLineSource), expected);
  assert.deepEqual(parseRegisteredMenuRoutes(wrappedSource), expected);
});

test("registry parsing tolerates a wrapped component import", () => {
  const source = `export const menuRouteRegistry = {
  "dashboard.overview": () => import("@/features/dashboard/pages/dashboard/index.vue"),
  "account.change-password": () =>
    import("@/features/profile/pages/profile/change-password/index.vue")
} satisfies Record<ManagedRouteKey, () => Promise<{ default: Component }>>;
`;
  assert.deepEqual(parseMenuRouteRegistry(source), [
    { routeKey: "dashboard.overview", specifier: "@/features/dashboard/pages/dashboard/index.vue" },
    {
      routeKey: "account.change-password",
      specifier: "@/features/profile/pages/profile/change-password/index.vue"
    }
  ]);
});

test("parsers reject sources without the expected declarations or fields", () => {
  assert.throws(() => parseRegisteredMenuRoutes("export const other = [];\n"), /registeredMenuRoutes/);
  assert.throws(
    () =>
      parseRegisteredMenuRoutes(
        'export const registeredMenuRoutes: ReadonlyArray<Meta> = [\n  { routeKey: "a.b", label: "A" }\n];\n'
      ),
    /defaultPath/
  );
  assert.throws(() => parseMenuRouteRegistry("export const other = {};\n"), /menuRouteRegistry/);
});

test("the repository registry exposes every formatted entry", async () => {
  const source = await readFile(registryPath, "utf8");
  const entries = parseRegisteredMenuRoutes(source);
  assert.equal(entries.length, 15);
  assert.ok(entries.every(entry => entry.label && entry.defaultPath.startsWith("/")));
  assert.equal(new Set(entries.map(entry => entry.routeKey)).size, entries.length);
  assert.equal(parseMenuRouteRegistry(source).length, 15);
});
