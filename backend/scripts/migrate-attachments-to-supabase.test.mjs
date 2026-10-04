import test from "node:test";
import assert from "node:assert/strict";
import {
  mapLegacyAttachment,
  parseArgs,
  validateUniqueAttachments
} from "./migrate-attachments-to-supabase.mjs";

const sourceAttachment = {
  id: "9007199254740993",
  original_name: "项目报告.pdf",
  stored_name: "bbde390a-925c-40fa-b9bc-303da7ca4083.pdf",
  mime_type: "application/pdf",
  file_ext: "pdf",
  file_size: "1024",
  business_module: "PROJECT",
  business_record_id: "9007199254740994",
  reference_status: 1,
  upload_user_id: "910000000000003",
  created_by: null,
  updated_by: "910000000000003",
  deleted: 0,
  uploaded_at_utc: "2026-10-02 02:00:00",
  created_at_utc: "2026-10-02 01:00:00",
  updated_at_utc: "2026-10-02 02:00:00"
};

test("maps attachment metadata losslessly and uses a private legacy object path", () => {
  const mapped = mapLegacyAttachment(sourceAttachment);
  assert.equal(mapped.id, "9007199254740993");
  assert.equal(mapped.business_record_id, "9007199254740994");
  assert.equal(mapped.storage_path, "legacy/9007199254740993/bbde390a-925c-40fa-b9bc-303da7ca4083.pdf");
  assert.equal(mapped.file_size, "1024");
  assert.equal(mapped.uploaded_at, "2026-10-02T02:00:00.000Z");
  assert.equal(mapped.created_at, "2026-10-02T01:00:00.000Z");
  assert.equal(mapped.deleted, false);
});

test("preserves optional module and record references independently", () => {
  const mapped = mapLegacyAttachment({
    ...sourceAttachment,
    business_module: "PROJECT",
    business_record_id: null,
    reference_status: 1
  });
  assert.equal(mapped.business_module, "PROJECT");
  assert.equal(mapped.business_record_id, null);
});

test("retains soft-deleted metadata without converting deleted flags to numbers", () => {
  const mapped = mapLegacyAttachment({ ...sourceAttachment, deleted: 1, reference_status: 0 });
  assert.equal(mapped.deleted, true);
  assert.equal(mapped.reference_status, 0);
});

test("rejects IDs outside signed BIGINT, oversized files, and unsafe stored names", () => {
  assert.throws(() => mapLegacyAttachment({
    ...sourceAttachment,
    id: "9223372036854775808"
  }), /signed BIGINT range/);
  assert.throws(() => mapLegacyAttachment({
    ...sourceAttachment,
    file_size: "20971521"
  }), /20 MiB Storage limit/);
  assert.throws(() => mapLegacyAttachment({
    ...sourceAttachment,
    stored_name: "../outside.pdf"
  }), /stored filename is invalid/);
});

test("rejects invalid status values and malformed timestamps", () => {
  assert.throws(() => mapLegacyAttachment({ ...sourceAttachment, deleted: 3 }), /deleted must be 0 or 1/);
  assert.throws(() => mapLegacyAttachment({ ...sourceAttachment, reference_status: 2 }), /reference_status must be 0 or 1/);
  assert.throws(() => mapLegacyAttachment({ ...sourceAttachment, uploaded_at_utc: "bad-date" }), /could not be converted to UTC/);
});

test("rejects duplicate IDs or storage paths across the source scan", () => {
  const first = mapLegacyAttachment(sourceAttachment);
  const duplicateId = { ...first, storage_path: "legacy/9007199254740993/another.pdf" };
  assert.throws(() => validateUniqueAttachments([first, duplicateId]), /duplicate IDs/);
  const duplicatePath = { ...first, id: "9007199254740995" };
  assert.throws(() => validateUniqueAttachments([first, duplicatePath]), /duplicate storage paths/);
});

test("requires explicit local source database and timezone before applying", () => {
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
