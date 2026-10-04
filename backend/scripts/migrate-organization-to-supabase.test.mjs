import test from "node:test";
import assert from "node:assert/strict";
import {
  mapLegacyOrganizationRow,
  validateUniqueOrganizationCodes
} from "./migrate-organization-to-supabase.mjs";

const department = {
  id: "9007199254740992",
  dept_code: "ENG",
  dept_name: "Engineering",
  status: 1,
  description: null,
  deleted: 0,
  created_at_utc: "2026-10-02 01:00:00",
  updated_at_utc: "2026-10-02 01:00:00"
};

test("maps department IDs losslessly and marks deleted rows without dropping them", () => {
  assert.deepEqual(mapLegacyOrganizationRow("departments", {
    ...department,
    deleted: 1
  }), {
    id: "9007199254740992",
    dept_code: "ENG",
    dept_name: "Engineering",
    status: 1,
    description: null,
    deleted: true,
    created_at: "2026-10-02T01:00:00.000Z",
    updated_at: "2026-10-02T01:00:00.000Z"
  });
});

test("maps posts through their separate legacy field names", () => {
  const mapped = mapLegacyOrganizationRow("posts", {
    id: "12",
    post_code: "ENG_LEAD",
    post_name: "Engineering Lead",
    status: 0,
    description: "Legacy role",
    deleted: 0,
    created_at_utc: "2026-10-02T01:00:00Z",
    updated_at_utc: "2026-10-02T02:00:00Z"
  });
  assert.equal(mapped.post_code, "ENG_LEAD");
  assert.equal(mapped.status, 0);
  assert.equal(mapped.deleted, false);
  assert.equal(mapped.updated_at, "2026-10-02T02:00:00.000Z");
});

test("rejects unsigned BIGINT values outside PostgreSQL's signed range", () => {
  assert.throws(() => mapLegacyOrganizationRow("departments", {
    ...department,
    id: "9223372036854775808"
  }), /PostgreSQL's signed BIGINT range/);
});

test("rejects invalid states, whitespace-altered codes, and invalid timestamps", () => {
  assert.throws(() => mapLegacyOrganizationRow("departments", {
    ...department,
    status: 2
  }), /status must be 0 or 1/);
  assert.throws(() => mapLegacyOrganizationRow("departments", {
    ...department,
    dept_code: " ENG "
  }), /surrounding whitespace/);
  assert.throws(() => mapLegacyOrganizationRow("departments", {
    ...department,
    created_at_utc: "not-a-date"
  }), /could not be converted to UTC/);
});

test("rejects case-insensitive duplicate codes across the complete source scan", () => {
  assert.throws(() => validateUniqueOrganizationCodes("departments", [
    { id: "1", dept_code: "Engineering" },
    { id: "2", dept_code: "engineering" }
  ]), /case-insensitive duplicate codes/);
});

test("rejects duplicate IDs and unsupported entity names", () => {
  assert.throws(() => validateUniqueOrganizationCodes("posts", [
    { id: "1", post_code: "A" },
    { id: "1", post_code: "B" }
  ]), /duplicate IDs/);
  assert.throws(() => mapLegacyOrganizationRow("teams", department), /Unsupported organization entity/);
});
