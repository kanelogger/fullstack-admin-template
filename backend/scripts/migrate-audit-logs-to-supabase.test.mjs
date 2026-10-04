import test from "node:test";
import assert from "node:assert/strict";
import {
  compactRequestParams,
  mapLegacyExceptionLog,
  mapLegacyLoginLog,
  mapLegacyOperationLog,
  parseArgs,
  redactAuditText
} from "./migrate-audit-logs-to-supabase.mjs";

const mappedProfiles = new Set(["9007199254740993", "910000000000003"]);
const loginLog = {
  id: "9007199254740995",
  user_id: "9007199254740993",
  login_name: "operator",
  login_ip: "127.0.0.1",
  user_agent: "Audit fixture",
  login_result: 1,
  failure_reason: null,
  logged_at_utc: "2026-10-02 02:00:00"
};

test("maps login log IDs as decimal text and converts its timestamp to UTC", () => {
  const mapped = mapLegacyLoginLog(loginLog, mappedProfiles, { unmappedActors: 0 });
  assert.equal(mapped.id, "9007199254740995");
  assert.equal(mapped.user_id, "9007199254740993");
  assert.equal(mapped.logged_at, "2026-10-02T02:00:00.000Z");
  assert.equal(mapped.login_result, 1);
});

test("preserves login history when the old actor has no Supabase profile mapping", () => {
  const stats = { unmappedActors: 0 };
  const mapped = mapLegacyLoginLog({ ...loginLog, user_id: "12345" }, mappedProfiles, stats);
  assert.equal(mapped.user_id, null);
  assert.equal(mapped.login_name, "operator");
  assert.equal(stats.unmappedActors, 1);
});

test("maps operation metadata while redacting secret-shaped request parameters", () => {
  const mapped = mapLegacyOperationLog({
    id: "42",
    operator_id: "910000000000003",
    operator_name: "管理员",
    module_code: "USER",
    operation_type: "UPDATE",
    request_method: "PATCH",
    request_path: "/functions/v1/user-management",
    request_params: JSON.stringify({ targetUserId: "9007199254740993", password: "dont-store", nested: { accessToken: "secret" } }),
    operation_result: 1,
    error_message: null,
    operated_at_utc: "2026-10-02T03:00:00Z"
  }, mappedProfiles, { unmappedActors: 0 });
  assert.equal(mapped.operator_id, "910000000000003");
  assert.equal(mapped.request_params.password, "***");
  assert.equal(mapped.request_params.nested.accessToken, "***");
  assert.equal(mapped.request_params.targetUserId, "9007199254740993");
});

test("compacts oversized request parameter documents to safe metadata", () => {
  const compact = compactRequestParams({ payload: "x".repeat(4000) });
  assert.deepEqual(compact, {
    truncated: true,
    reason: "source request parameters exceeded 3000 bytes"
  });
});

test("redacts credentials from legacy exception text", () => {
  assert.equal(
    redactAuditText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9; password="private"'),
    "Authorization=***; password=***"
  );
  assert.equal(
    redactAuditText('{"password":"private value","refreshToken":"raw-token"}'),
    "{password=***,refreshToken=***}"
  );
});

test("maps exception details and handles missing actors as nullable by design", () => {
  const mapped = mapLegacyExceptionLog({
    id: "55",
    request_path: "/api/users",
    request_method: "POST",
    error_type: "Error",
    error_message: "request failed",
    stack_summary: null,
    handled_status: 0,
    occurred_at_utc: "2026-10-02 04:00:00"
  });
  assert.equal(mapped.id, "55");
  assert.equal(mapped.handled_status, 0);
  assert.equal(mapped.occurred_at, "2026-10-02T04:00:00.000Z");
});

test("rejects unsigned BIGINT IDs outside PostgreSQL's signed range", () => {
  assert.throws(() => mapLegacyLoginLog({ ...loginLog, id: "9223372036854775808" }, mappedProfiles, { unmappedActors: 0 }), /signed BIGINT range/);
});

test("requires explicit local database and source timezone flags", () => {
  assert.deepEqual(parseArgs([
    "--confirm-source-database", "fullstack_admin_template_test",
    "--source-timezone", "+08:00",
    "--apply-local"
  ]), {
    applyLocal: true,
    confirmDatabase: "fullstack_admin_template_test",
    sourceTimezone: "+08:00"
  });
  assert.throws(() => parseArgs(["--remote"]), /Unsupported argument/);
});
