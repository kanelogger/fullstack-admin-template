import test from "node:test";
import assert from "node:assert/strict";
import {
  mapLegacyDictionaryItem,
  mapLegacyDictionaryType,
  mapLegacySystemConfig,
  validateUniqueRows
} from "./migrate-dictionary-configuration-to-supabase.mjs";

const common = {
  status: 1,
  description: null,
  created_by: null,
  updated_by: "9007199254740993",
  deleted: 0,
  created_at_utc: "2026-10-02 03:00:00",
  updated_at_utc: "2026-10-02T04:00:00Z"
};

test("maps dictionary type IDs and nullable actor IDs as exact decimal text", () => {
  const result = mapLegacyDictionaryType({
    ...common,
    id: "9223372036854775807",
    dict_code: "user_status",
    dict_name: "用户状态"
  });
  assert.equal(result.id, "9223372036854775807");
  assert.equal(result.created_by, null);
  assert.equal(result.updated_by, "9007199254740993");
  assert.equal(result.created_at, "2026-10-02T03:00:00.000Z");
  assert.equal(result.deleted, 0);
});

test("maps dictionary items with string type IDs and integer sort order", () => {
  const result = mapLegacyDictionaryItem({
    ...common,
    id: "9",
    dict_type_id: "9007199254740994",
    item_value: "1",
    item_label: "启用",
    sort_order: 12,
    deleted: 1
  });
  assert.equal(result.id, "9");
  assert.equal(result.dict_type_id, "9007199254740994");
  assert.equal(result.sort_order, 12);
  assert.equal(result.deleted, 1);
});

test("maps system configuration values while retaining the supported value type", () => {
  const result = mapLegacySystemConfig({
    ...common,
    id: "4",
    config_code: "SYSTEM_NAME",
    config_name: "系统名称",
    config_value: "PC Admin",
    value_type: "STRING"
  });
  assert.equal(result.config_value, "PC Admin");
  assert.equal(result.value_type, "STRING");
  assert.equal(result.created_by, null);
});

test("rejects unsigned IDs outside PostgreSQL BIGINT and invalid states/types", () => {
  assert.throws(() => mapLegacyDictionaryType({
    ...common,
    id: "9223372036854775808",
    dict_code: "bad",
    dict_name: "无效 ID"
  }), /PostgreSQL's signed BIGINT range/);
  assert.throws(() => mapLegacyDictionaryItem({
    ...common,
    id: "1",
    dict_type_id: "0",
    item_value: "x",
    item_label: "x",
    sort_order: 0
  }), /positive BIGINT/);
  assert.throws(() => mapLegacySystemConfig({
    ...common,
    id: "1",
    config_code: "x",
    config_name: "x",
    config_value: "x",
    value_type: "BINARY"
  }), /value_type is not supported/);
});

test("rejects duplicate IDs and duplicate source business keys before writes", () => {
  assert.throws(() => validateUniqueRows("dictionaryTypes", [
    { id: "1", dict_code: "Status" },
    { id: "2", dict_code: "status" }
  ]), /duplicate business keys/);
  assert.throws(() => validateUniqueRows("dictionaryItems", [
    { id: "1", dict_type_id: "3", item_value: "A", deleted: 0 },
    { id: "2", dict_type_id: "3", item_value: "a", deleted: 0 }
  ]), /duplicate business keys/);
  assert.doesNotThrow(() => validateUniqueRows("dictionaryItems", [
    { id: "1", dict_type_id: "3", item_value: "A", deleted: 0 },
    { id: "2", dict_type_id: "3", item_value: "a", deleted: 1 }
  ]));
});
