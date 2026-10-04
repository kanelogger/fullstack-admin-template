import assert from "node:assert/strict";
import test from "node:test";
import { mapLegacyMessageRow } from "./migrate-messages-to-supabase.mjs";

function validLegacyMessage(overrides = {}) {
  return {
    id: "9223372036854775807",
    receiver_id: "910000000000001",
    sender_id: null,
    title: "Legacy notice",
    summary: null,
    content: "",
    message_type: "CUSTOM_NOTICE",
    read_status: 1,
    sent_at_utc: "2026-10-01 18:00:00.000000",
    read_at_utc: null,
    created_by: null,
    created_at_utc: "2026-10-01 17:59:00.000000",
    updated_by: null,
    updated_at_utc: "2026-10-01 18:00:00.000000",
    deleted: 0,
    ...overrides
  };
}

test("preserves BIGINT IDs, custom message types, and read rows with a null read_at", () => {
  const mapped = mapLegacyMessageRow(validLegacyMessage());

  assert.equal(mapped.id, "9223372036854775807");
  assert.equal(mapped.receiver_id, "910000000000001");
  assert.equal(mapped.message_type, "CUSTOM_NOTICE");
  assert.equal(mapped.read_status, true);
  assert.equal(mapped.read_at, null);
  assert.equal(mapped.content, "");
  assert.equal(mapped.sent_at, "2026-10-01T18:00:00.000Z");
});

test("rejects IDs outside PostgreSQL signed BIGINT and invalid read flags", () => {
  assert.throws(
    () => mapLegacyMessageRow(validLegacyMessage({ id: "9223372036854775808" })),
    /PostgreSQL's signed BIGINT range/
  );
  assert.throws(
    () => mapLegacyMessageRow(validLegacyMessage({ read_status: 2 })),
    /read_status must be 0 or 1/
  );
});

test("rejects timestamps that cannot be converted from the declared MySQL timezone", () => {
  assert.throws(
    () => mapLegacyMessageRow(validLegacyMessage({ sent_at_utc: null })),
    /could not be converted to UTC/
  );
});
