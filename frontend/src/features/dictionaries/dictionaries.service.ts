import {
  DictionaryOptionsRequestSchema,
  DictionaryOptionsSchema,
  DictionaryTypeListPageSchema,
  DictionaryTypeListRequestSchema,
  DictionaryItemSchema,
  DictionaryTypeSchema,
  ReplaceDictionaryItemOrderRequestSchema,
  SaveDictionaryItemRequestSchema,
  SaveDictionaryTypeRequestSchema,
  type DictionaryItem,
  type DictionaryOption,
  type DictionaryType,
  type DictionaryTypeListPage
} from "@template/contracts/dictionary";
import { BusinessIdSchema } from "@template/contracts/ids";
import { getSupabaseClient } from "@/lib/supabase/client";

function throwOnError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

export async function listDictionaryTypes(input: unknown): Promise<DictionaryTypeListPage> {
  const request = DictionaryTypeListRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("admin_dictionary_types", {
    p_dict_code: request.dictCode || null,
    p_dict_name: request.dictName || null,
    p_status: request.status ?? null,
    p_page: request.page,
    p_page_size: request.pageSize
  });
  throwOnError(error, "字典类型加载失败");
  return DictionaryTypeListPageSchema.parse(data);
}

export async function listDictionaryItems(dictTypeIdInput: unknown): Promise<DictionaryItem[]> {
  const dictTypeId = BusinessIdSchema.parse(dictTypeIdInput);
  const { data, error } = await getSupabaseClient().rpc("admin_dictionary_items", {
    p_dict_type_id: dictTypeId
  });
  throwOnError(error, "字典项加载失败");
  return DictionaryItemSchema.array().parse(data);
}

export async function saveDictionaryType(input: unknown): Promise<DictionaryType> {
  const request = SaveDictionaryTypeRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("save_dictionary_type", {
    p_id: request.id ?? null,
    p_dict_code: request.dictCode,
    p_dict_name: request.dictName,
    p_status: request.status,
    p_description: request.description
  });
  throwOnError(error, "字典类型保存失败");
  return DictionaryTypeSchema.parse(data);
}

export async function saveDictionaryItem(input: unknown): Promise<DictionaryItem> {
  const request = SaveDictionaryItemRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("save_dictionary_item", {
    p_id: request.id ?? null,
    p_dict_type_id: request.dictTypeId,
    p_item_value: request.itemValue,
    p_item_label: request.itemLabel,
    p_sort_order: request.sortOrder,
    p_status: request.status,
    p_description: request.description
  });
  throwOnError(error, "字典项保存失败");
  return DictionaryItemSchema.parse(data);
}

export async function replaceDictionaryItemOrder(input: unknown): Promise<void> {
  const request = ReplaceDictionaryItemOrderRequestSchema.parse(input);
  const { error } = await getSupabaseClient().rpc("replace_dictionary_item_order", {
    p_dict_type_id: request.dictTypeId,
    p_items: request.items
  });
  throwOnError(error, "字典项排序保存失败");
}

export async function softDeleteDictionaryType(idInput: unknown): Promise<void> {
  const dictTypeId = BusinessIdSchema.parse(idInput);
  const { error } = await getSupabaseClient().rpc("soft_delete_dictionary_type", {
    p_dict_type_id: dictTypeId
  });
  throwOnError(error, "字典类型删除失败");
}

export async function softDeleteDictionaryItem(idInput: unknown): Promise<void> {
  const dictItemId = BusinessIdSchema.parse(idInput);
  const { error } = await getSupabaseClient().rpc("soft_delete_dictionary_item", {
    p_dict_item_id: dictItemId
  });
  throwOnError(error, "字典项删除失败");
}

export async function listDictionaryOptions(input: unknown): Promise<DictionaryOption[]> {
  const request = DictionaryOptionsRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("dictionary_options", {
    p_dict_code: request.dictCode,
    p_enabled_only: request.enabledOnly
  });
  throwOnError(error, "字典选项加载失败");
  return DictionaryOptionsSchema.parse(data);
}
