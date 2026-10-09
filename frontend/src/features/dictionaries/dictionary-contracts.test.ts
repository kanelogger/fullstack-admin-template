import { describe, expect, it } from "vitest";
import {
  DictionaryItemSchema,
  DictionaryTypeListRequestSchema,
  ReplaceDictionaryItemOrderRequestSchema,
  SaveDictionaryItemRequestSchema,
  SaveDictionaryTypeRequestSchema
} from "@template/contracts/dictionary";

describe("dictionary contracts", () => {
  it("keeps BIGINT type and item IDs as decimal strings", () => {
    const id = "9223372036854775807";
    const item = {
      id,
      dictTypeId: "9007199254740993",
      itemValue: "1",
      itemLabel: "启用",
      sortOrder: 1,
      status: 1,
      description: null,
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z"
    };
    expect(DictionaryItemSchema.parse(item)).toEqual(item);
    expect(
      DictionaryItemSchema.safeParse({ ...item, id: Number("9223372036854775807") }).success
    ).toBe(false);
    expect(DictionaryItemSchema.safeParse({ ...item, dictTypeId: 12 }).success).toBe(false);
  });

  it("normalizes filters and preserves the legacy 0/1 status model", () => {
    expect(
      DictionaryTypeListRequestSchema.parse({ dictCode: " user_status ", page: 2 })
    ).toMatchObject({
      dictCode: "user_status",
      page: 2,
      pageSize: 20
    });
    expect(
      SaveDictionaryTypeRequestSchema.parse({
        dictCode: "message_type",
        dictName: "消息类型"
      })
    ).toMatchObject({ status: 1, description: null });
    expect(
      SaveDictionaryItemRequestSchema.safeParse({
        dictTypeId: "1",
        itemValue: " ",
        itemLabel: "启用"
      }).success
    ).toBe(false);
    expect(
      SaveDictionaryTypeRequestSchema.safeParse({
        dictCode: "role",
        dictName: "角色",
        status: 2
      }).success
    ).toBe(false);
  });

  it("rejects duplicate IDs in a full order replacement payload", () => {
    expect(
      ReplaceDictionaryItemOrderRequestSchema.safeParse({
        dictTypeId: "3",
        items: [
          { id: "1", sortOrder: 1 },
          { id: "1", sortOrder: 2 }
        ]
      }).success
    ).toBe(false);
  });
});
