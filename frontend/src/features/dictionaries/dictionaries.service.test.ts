import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => ({ rpc: mocks.rpc }) }));

import {
  listDictionaryTypes,
  replaceDictionaryItemOrder,
  saveDictionaryItem
} from "./dictionaries.service";

const typeId = "9007199254740993";
const itemId = "9007199254740995";
const now = "2026-10-07T02:00:00.000Z";

describe("dictionaries service", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("loads dictionary type pages with decimal string IDs and normalized filters", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        items: [
          {
            id: typeId,
            dictCode: "USER_STATE",
            dictName: "用户状态",
            status: 1,
            description: null,
            createdAt: now,
            updatedAt: now
          }
        ],
        total: 1,
        page: 1,
        pageSize: 10
      },
      error: null
    });

    const result = await listDictionaryTypes({ dictCode: " USER_STATE ", page: 1, pageSize: 10 });

    expect(result.items[0]?.id).toBe(typeId);
    expect(mocks.rpc).toHaveBeenCalledWith("admin_dictionary_types", {
      p_dict_code: "USER_STATE",
      p_dict_name: null,
      p_status: null,
      p_page: 1,
      p_page_size: 10
    });
  });

  it("saves dictionary items and replaces ordering without numeric ID coercion", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: {
          id: itemId,
          dictTypeId: typeId,
          itemValue: "active",
          itemLabel: "在职",
          sortOrder: 2,
          status: 1,
          description: null,
          createdAt: now,
          updatedAt: now
        },
        error: null
      })
      .mockResolvedValueOnce({ data: null, error: null });

    const item = await saveDictionaryItem({
      dictTypeId: typeId,
      itemValue: "active",
      itemLabel: "在职",
      sortOrder: 2
    });
    await replaceDictionaryItemOrder({ dictTypeId: typeId, items: [{ id: itemId, sortOrder: 0 }] });

    expect(item.id).toBe(itemId);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "replace_dictionary_item_order", {
      p_dict_type_id: typeId,
      p_items: [{ id: itemId, sortOrder: 0 }]
    });
  });
});
