import test from "node:test";
import assert from "node:assert/strict";
import { mapLegacyMenuRow } from "./migrate-menus-to-supabase.mjs";

function legacyMenu(overrides = {}) {
  return {
    id: "11",
    parent_id: "10",
    menu_code: "OPERATION_MESSAGE",
    menu_name: "消息中心",
    icon: "Message",
    sort_order: 0,
    route_path: "/operation/messages",
    component_path: "/operation/message/index",
    visible: 1,
    status: 1,
    meta_json: { title: "收件箱" },
    ...overrides
  };
}

test("maps an approved legacy component path to a stable RouteKey and permission", () => {
  assert.deepEqual(mapLegacyMenuRow(legacyMenu()), {
    id: "11",
    parent_id: "10",
    kind: "route",
    route_key: "communication.messages",
    path: "/operation/messages",
    title: "收件箱",
    icon: "Message",
    sort_order: 0,
    is_visible: true,
    is_active: true,
    required_permission_key: "communication.messages.read"
  });
});

test("maps a componentless legacy row to a group without a permission key", () => {
  const result = mapLegacyMenuRow(legacyMenu({
    id: "10",
    parent_id: null,
    menu_code: "OPERATION",
    menu_name: "运营管理",
    route_path: "/operation",
    component_path: null,
    meta_json: "{\"title\":\"运营管理\"}"
  }));

  assert.equal(result.kind, "group");
  assert.equal(result.route_key, null);
  assert.equal(result.required_permission_key, null);
});

test("preserves hidden and disabled navigation flags", () => {
  const result = mapLegacyMenuRow(legacyMenu({
    visible: 0,
    status: 0,
    meta_json: "{\"title\":\"消息中心\",\"showLink\":false}"
  }));

  assert.equal(result.is_visible, false);
  assert.equal(result.is_active, false);
});

test("rejects unregistered component paths and invalid source statuses", () => {
  assert.throws(
    () => mapLegacyMenuRow(legacyMenu({ component_path: "/views/custom/unknown.vue" })),
    /not in the local route registry/
  );
  assert.throws(
    () => mapLegacyMenuRow(legacyMenu({ status: 2 })),
    /must be 0 or 1/
  );
});

test("rejects route paths that cannot be represented by the supported router contract", () => {
  assert.throws(
    () => mapLegacyMenuRow(legacyMenu({ route_path: "https://example.test" })),
    /path is invalid/
  );
});

test("rejects IDs outside PostgreSQL signed BIGINT", () => {
  assert.throws(
    () => mapLegacyMenuRow(legacyMenu({ id: "9223372036854775808" })),
    /exceeds PostgreSQL BIGINT/
  );
});
