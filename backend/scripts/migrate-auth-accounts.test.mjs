import test from "node:test";
import assert from "node:assert/strict";
import {
  collectOrganizationReferenceIds,
  mapLegacyAccountRow
} from "./migrate-auth-accounts.mjs";

const roleIdByCode = new Map([
  ["COMMON_USER", "3"],
  ["OPERATOR", "2"]
]);

function account(overrides = {}) {
  return {
    id: "42",
    user_code: "U0042",
    login_name: "kane",
    display_name: "Kane",
    email: "KANE@example.test",
    phone: "13800000000",
    department_id: "12000000000001",
    post_id: "12000000000002",
    status: 1,
    role_codes: "COMMON_USER,OPERATOR,COMMON_USER",
    created_at_utc: "2026-10-01 12:00:00.000",
    updated_at_utc: "2026-10-02 12:00:00.000",
    ...overrides
  };
}

test("maps a legacy user to string BIGINTs, normalized email, and distinct roles", () => {
  const result = mapLegacyAccountRow(account(), roleIdByCode);

  assert.equal(result.id, "42");
  assert.equal(result.email, "kane@example.test");
  assert.equal(result.department_id, "12000000000001");
  assert.equal(result.post_id, "12000000000002");
  assert.deepEqual(result.role_codes, ["COMMON_USER", "OPERATOR"]);
  assert.deepEqual(result.role_ids, ["3", "2"]);
  assert.equal(result.created_at, "2026-10-01T12:00:00.000Z");
  assert.equal(result.is_active, true);
  assert.equal(Object.hasOwn(result, "password"), false);
  assert.equal(Object.hasOwn(result, "password_hash"), false);
});

test("maps an inactive account without inventing role assignments", () => {
  const result = mapLegacyAccountRow(account({ status: 0, role_codes: null }), roleIdByCode);

  assert.equal(result.is_active, false);
  assert.deepEqual(result.role_codes, []);
  assert.deepEqual(result.role_ids, []);
});

test("rejects IDs that cannot be preserved by PostgreSQL and the active Fastify bridge", () => {
  assert.throws(
    () => mapLegacyAccountRow(account({ id: "9007199254740992" }), roleIdByCode),
    /active Fastify number range/
  );
  assert.throws(
    () => mapLegacyAccountRow(account({ department_id: "9223372036854775808" }), roleIdByCode),
    /exceeds PostgreSQL BIGINT/
  );
});

test("rejects malformed identifiers, account fields, statuses, and timestamps", () => {
  for (const [row, expected] of [
    [account({ status: 2 }), /status must be 0 or 1/],
    [account({ email: "not-an-email" }), /email is missing or invalid/],
    [account({ login_name: "  " }), /login_name is empty or too long/],
    [account({ user_code: "" }), /user_code is empty or too long/],
    [account({ created_at_utc: null }), /created_at could not be converted to UTC/]
  ]) {
    assert.throws(() => mapLegacyAccountRow(row, roleIdByCode), expected);
  }
});

test("requires every legacy role to map to an active Supabase role", () => {
  assert.throws(
    () => mapLegacyAccountRow(account({ role_codes: "DELETED_ROLE" }), roleIdByCode),
    /has no active Supabase mapping/
  );
});

test("collects distinct decimal-text organization IDs for the server-side preflight", () => {
  const first = mapLegacyAccountRow(account(), roleIdByCode);
  const second = mapLegacyAccountRow(account({
    id: "43",
    user_code: "U0043",
    login_name: "kane2",
    email: "kane2@example.test"
  }), roleIdByCode);
  assert.deepEqual(collectOrganizationReferenceIds([first, second]), {
    departmentIds: ["12000000000001"],
    postIds: ["12000000000002"]
  });
  assert.deepEqual(collectOrganizationReferenceIds([
    mapLegacyAccountRow(account({ department_id: null, post_id: null }), roleIdByCode)
  ]), { departmentIds: [], postIds: [] });
});
