import { requestConfirmation } from "@/composables/use-confirmation";
import { computed, onMounted, reactive, ref } from "vue";
import type { DictionaryItem, DictionaryType } from "@template/contracts/dictionary";
import {
  listDictionaryItems,
  listDictionaryTypes,
  replaceDictionaryItemOrder,
  saveDictionaryItem,
  saveDictionaryType,
  softDeleteDictionaryItem,
  softDeleteDictionaryType
} from "@/features/dictionaries/dictionaries.service";
import { usePermissionStoreHook } from "@/stores/modules/permission";

export type StatusFilter = "all" | "0" | "1";
export type EditorMode = "create" | "edit";

export function useDictionariesPage() {
  const permissionSet = computed(() => new Set(usePermissionStoreHook().permissionKeys));
  const canCreate = computed(() => permissionSet.value.has("configuration.dictionaries.create"));
  const canUpdate = computed(() => permissionSet.value.has("configuration.dictionaries.update"));
  const canDelete = computed(() => permissionSet.value.has("configuration.dictionaries.delete"));

  const typeRows = ref<DictionaryType[]>([]);
  const itemRows = ref<DictionaryItem[]>([]);
  const selectedTypeId = ref("");
  const typeLoading = ref(false);
  const itemLoading = ref(false);
  const saving = ref(false);
  const typeError = ref("");
  const itemError = ref("");
  const actionError = ref("");
  const typeEditorOpen = ref(false);
  const itemEditorOpen = ref(false);
  const typeEditorMode = ref<EditorMode>("create");
  const itemEditorMode = ref<EditorMode>("create");
  const editingType = ref<DictionaryType | null>(null);
  const editingItem = ref<DictionaryItem | null>(null);
  const typePage = ref(1);
  const typePageSize = ref(10);
  const typeTotal = ref(0);
  const typeNameFilter = ref("");
  const typeCodeFilter = ref("");
  const typeStatusFilter = ref<StatusFilter>("all");

  const selectedType = computed(
    () => typeRows.value.find((type) => type.id === selectedTypeId.value) ?? null
  );
  const typePageCount = computed(() =>
    Math.max(1, Math.ceil(typeTotal.value / typePageSize.value))
  );

  const typeForm = reactive({
    dictCode: "",
    dictName: "",
    status: 1 as 0 | 1,
    description: ""
  });
  const itemForm = reactive({
    itemValue: "",
    itemLabel: "",
    sortOrder: 0,
    status: 1 as 0 | 1,
    description: ""
  });

  function errorText(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function loadItems(typeId = selectedTypeId.value) {
    if (!typeId) {
      itemRows.value = [];
      itemError.value = "";
      return;
    }
    itemLoading.value = true;
    itemError.value = "";
    try {
      itemRows.value = await listDictionaryItems(typeId);
    } catch (error) {
      itemRows.value = [];
      itemError.value = errorText(error, "字典项读取失败。");
    } finally {
      itemLoading.value = false;
    }
  }

  async function loadTypes() {
    typeLoading.value = true;
    typeError.value = "";
    try {
      const result = await listDictionaryTypes({
        dictCode: typeCodeFilter.value.trim() || undefined,
        dictName: typeNameFilter.value.trim() || undefined,
        status: typeStatusFilter.value === "all" ? undefined : Number(typeStatusFilter.value),
        page: typePage.value,
        pageSize: typePageSize.value
      });
      typeRows.value = result.items;
      typeTotal.value = result.total;
      if (!typeRows.value.some((type) => type.id === selectedTypeId.value)) {
        selectedTypeId.value = typeRows.value[0]?.id ?? "";
      }
      await loadItems();
    } catch (error) {
      typeRows.value = [];
      itemRows.value = [];
      typeTotal.value = 0;
      typeError.value = errorText(error, "字典类型读取失败。");
    } finally {
      typeLoading.value = false;
    }
  }

  async function searchTypes() {
    typePage.value = 1;
    selectedTypeId.value = "";
    await loadTypes();
  }

  async function selectType(type: DictionaryType) {
    if (selectedTypeId.value === type.id) return;
    selectedTypeId.value = type.id;
    await loadItems(type.id);
  }

  function openCreateType() {
    typeEditorMode.value = "create";
    editingType.value = null;
    Object.assign(typeForm, { dictCode: "", dictName: "", status: 1, description: "" });
    actionError.value = "";
    typeEditorOpen.value = true;
  }

  function openEditType(type: DictionaryType) {
    typeEditorMode.value = "edit";
    editingType.value = type;
    Object.assign(typeForm, {
      dictCode: type.dictCode,
      dictName: type.dictName,
      status: type.status,
      description: type.description ?? ""
    });
    actionError.value = "";
    typeEditorOpen.value = true;
  }

  async function saveType() {
    if (saving.value) return;
    saving.value = true;
    actionError.value = "";
    try {
      const saved = await saveDictionaryType({
        ...(editingType.value ? { id: editingType.value.id } : {}),
        dictCode: typeForm.dictCode,
        dictName: typeForm.dictName,
        status: typeForm.status,
        description: typeForm.description.trim() || null
      });
      if (typeEditorMode.value === "create") typePage.value = 1;
      selectedTypeId.value = saved.id;
      typeEditorOpen.value = false;
      await loadTypes();
    } catch (error) {
      actionError.value = errorText(error, "字典类型保存失败。");
    } finally {
      saving.value = false;
    }
  }

  async function toggleTypeStatus(type: DictionaryType) {
    actionError.value = "";
    try {
      await saveDictionaryType({
        id: type.id,
        dictCode: type.dictCode,
        dictName: type.dictName,
        status: type.status === 1 ? 0 : 1,
        description: type.description
      });
      await loadTypes();
    } catch (error) {
      actionError.value = errorText(error, "字典类型状态更新失败。");
    }
  }

  async function removeType(type: DictionaryType) {
    if (!(await requestConfirmation(`确认删除字典类型“${type.dictName}”？`))) return;
    actionError.value = "";
    try {
      await softDeleteDictionaryType(type.id);
      if (selectedTypeId.value === type.id) selectedTypeId.value = "";
      await loadTypes();
    } catch (error) {
      actionError.value = errorText(error, "字典类型删除失败。启用中的字典项需先停用或删除。");
    }
  }

  function openCreateItem() {
    if (!selectedType.value) return;
    itemEditorMode.value = "create";
    editingItem.value = null;
    Object.assign(itemForm, {
      itemValue: "",
      itemLabel: "",
      sortOrder: itemRows.value.length,
      status: 1,
      description: ""
    });
    actionError.value = "";
    itemEditorOpen.value = true;
  }

  function openEditItem(item: DictionaryItem) {
    itemEditorMode.value = "edit";
    editingItem.value = item;
    Object.assign(itemForm, {
      itemValue: item.itemValue,
      itemLabel: item.itemLabel,
      sortOrder: item.sortOrder,
      status: item.status,
      description: item.description ?? ""
    });
    actionError.value = "";
    itemEditorOpen.value = true;
  }

  async function saveItem() {
    if (!selectedType.value || saving.value) return;
    saving.value = true;
    actionError.value = "";
    try {
      await saveDictionaryItem({
        ...(editingItem.value ? { id: editingItem.value.id } : {}),
        dictTypeId: selectedType.value.id,
        itemValue: itemForm.itemValue,
        itemLabel: itemForm.itemLabel,
        sortOrder: Number(itemForm.sortOrder),
        status: itemForm.status,
        description: itemForm.description.trim() || null
      });
      itemEditorOpen.value = false;
      await loadItems();
    } catch (error) {
      actionError.value = errorText(error, "字典项保存失败。");
    } finally {
      saving.value = false;
    }
  }

  async function toggleItemStatus(item: DictionaryItem) {
    actionError.value = "";
    try {
      await saveDictionaryItem({
        id: item.id,
        dictTypeId: item.dictTypeId,
        itemValue: item.itemValue,
        itemLabel: item.itemLabel,
        sortOrder: item.sortOrder,
        status: item.status === 1 ? 0 : 1,
        description: item.description
      });
      await loadItems();
    } catch (error) {
      actionError.value = errorText(error, "字典项状态更新失败。");
    }
  }

  async function saveItemOrder() {
    if (!selectedType.value) return;
    actionError.value = "";
    try {
      await replaceDictionaryItemOrder({
        dictTypeId: selectedType.value.id,
        items: itemRows.value.map((item) => ({ id: item.id, sortOrder: Number(item.sortOrder) }))
      });
      await loadItems();
    } catch (error) {
      actionError.value = errorText(error, "字典项排序保存失败。");
    }
  }

  async function removeItem(item: DictionaryItem) {
    if (!(await requestConfirmation(`确认删除字典项“${item.itemLabel}”？`))) return;
    actionError.value = "";
    try {
      await softDeleteDictionaryItem(item.id);
      await loadItems();
    } catch (error) {
      actionError.value = errorText(error, "字典项删除失败。");
    }
  }

  onMounted(loadTypes);
  return {
    permissionSet,
    canCreate,
    canUpdate,
    canDelete,
    typeRows,
    itemRows,
    selectedTypeId,
    typeLoading,
    itemLoading,
    saving,
    typeError,
    itemError,
    actionError,
    typeEditorOpen,
    itemEditorOpen,
    typeEditorMode,
    itemEditorMode,
    editingType,
    editingItem,
    typePage,
    typePageSize,
    typeTotal,
    typeNameFilter,
    typeCodeFilter,
    typeStatusFilter,
    selectedType,
    typePageCount,
    typeForm,
    itemForm,
    errorText,
    loadItems,
    loadTypes,
    searchTypes,
    selectType,
    openCreateType,
    openEditType,
    saveType,
    toggleTypeStatus,
    removeType,
    openCreateItem,
    openEditItem,
    saveItem,
    toggleItemStatus,
    saveItemOrder,
    removeItem
  };
}
