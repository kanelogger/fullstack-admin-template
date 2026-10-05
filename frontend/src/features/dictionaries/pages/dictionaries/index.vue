<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

defineOptions({ name: "SystemDict" });

type StatusFilter = "all" | "0" | "1";
type EditorMode = "create" | "edit";

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
  () => typeRows.value.find(type => type.id === selectedTypeId.value) ?? null
);
const typePageCount = computed(() => Math.max(1, Math.ceil(typeTotal.value / typePageSize.value)));

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
    if (!typeRows.value.some(type => type.id === selectedTypeId.value)) {
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
  if (!window.confirm(`确认删除字典类型“${type.dictName}”？`)) return;
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
      items: itemRows.value.map(item => ({ id: item.id, sortOrder: Number(item.sortOrder) }))
    });
    await loadItems();
  } catch (error) {
    actionError.value = errorText(error, "字典项排序保存失败。");
  }
}

async function removeItem(item: DictionaryItem) {
  if (!window.confirm(`确认删除字典项“${item.itemLabel}”？`)) return;
  actionError.value = "";
  try {
    await softDeleteDictionaryItem(item.id);
    await loadItems();
  } catch (error) {
    actionError.value = errorText(error, "字典项删除失败。");
  }
}

onMounted(loadTypes);
</script>

<template>
  <main class="space-y-4 p-4" data-testid="dictionary-management">
    <Card>
      <CardHeader class="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>数据字典</CardTitle>
        <Button v-if="canCreate" data-testid="create-dictionary-type" @click="openCreateType">新增类型</Button>
      </CardHeader>
      <CardContent class="space-y-4">
        <form class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_auto]" @submit.prevent="searchTypes">
          <div class="space-y-1.5"><Label for="dict-code-filter">字典编码</Label><Input id="dict-code-filter" v-model="typeCodeFilter" placeholder="按编码筛选" /></div>
          <div class="space-y-1.5"><Label for="dict-name-filter">字典名称</Label><Input id="dict-name-filter" v-model="typeNameFilter" placeholder="按名称筛选" /></div>
          <div class="space-y-1.5"><Label for="dict-status-filter">状态</Label><select id="dict-status-filter" v-model="typeStatusFilter" class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="all">全部</option><option value="1">启用</option><option value="0">停用</option></select></div>
          <div class="flex items-end"><Button type="submit" variant="outline">筛选</Button></div>
        </form>
        <p v-if="actionError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{{ actionError }}</p>
        <p v-if="typeError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{{ typeError }}</p>
        <div v-if="typeLoading" role="status" class="py-8 text-center text-sm text-muted-foreground">正在加载字典…</div>
        <div v-else-if="typeError" class="text-center"><Button variant="outline" @click="loadTypes">重试</Button></div>
        <div v-else class="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(560px,1.4fr)]">
          <Card class="min-w-0">
            <CardHeader class="flex flex-row items-center justify-between gap-2"><CardTitle class="text-base">字典类型</CardTitle><span class="text-xs text-muted-foreground">{{ typeTotal }} 条</span></CardHeader>
            <CardContent class="space-y-3">
              <div v-if="!typeRows.length" class="py-8 text-center text-sm text-muted-foreground">暂无字典类型</div>
              <div v-else class="overflow-x-auto rounded-md border">
                <table class="w-full min-w-[520px] text-left text-sm">
                  <thead class="bg-muted/50 text-muted-foreground"><tr><th class="px-3 py-2 font-medium">编码 / 名称</th><th class="px-3 py-2 font-medium">状态</th><th class="px-3 py-2 font-medium">操作</th></tr></thead>
                  <tbody><tr v-for="type in typeRows" :key="type.id" :class="['cursor-pointer border-t', selectedTypeId === type.id ? 'bg-accent/50' : '']" @click="selectType(type)">
                    <td class="px-3 py-2"><div class="font-mono text-xs">{{ type.dictCode }}</div><div class="font-medium">{{ type.dictName }}</div></td>
                    <td class="px-3 py-2"><Badge :variant="type.status === 1 ? 'default' : 'secondary'">{{ type.status === 1 ? "启用" : "停用" }}</Badge></td>
                    <td class="px-3 py-2"><div class="flex gap-1" @click.stop><Button v-if="canUpdate" size="sm" variant="outline" @click="openEditType(type)">编辑</Button><Button v-if="canUpdate" size="sm" variant="ghost" @click="toggleTypeStatus(type)">{{ type.status === 1 ? "停用" : "启用" }}</Button><Button v-if="canDelete" size="sm" variant="ghost" class="text-destructive" @click="removeType(type)">删除</Button></div></td>
                  </tr></tbody>
                </table>
              </div>
              <div class="flex items-center justify-end gap-2 text-xs">
                <Button size="sm" variant="outline" :disabled="typePage <= 1" @click="typePage--; loadTypes()">上一页</Button><span>第 {{ typePage }} / {{ typePageCount }} 页</span><Button size="sm" variant="outline" :disabled="typePage >= typePageCount" @click="typePage++; loadTypes()">下一页</Button>
                <select v-model.number="typePageSize" aria-label="每页类型数" class="h-8 rounded-md border bg-background px-2" @change="typePage = 1; loadTypes()"><option :value="10">10</option><option :value="20">20</option><option :value="50">50</option></select>
              </div>
            </CardContent>
          </Card>

          <Card class="min-w-0">
            <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3"><div><CardTitle class="text-base">{{ selectedType?.dictName ?? "字典项" }}</CardTitle><p class="text-xs text-muted-foreground">{{ selectedType?.dictCode ?? "选择一个字典类型查看字典项" }}</p></div><div class="flex gap-2"><Button v-if="canUpdate" variant="outline" :disabled="!selectedType || !itemRows.length" @click="saveItemOrder">保存排序</Button><Button v-if="canCreate" :disabled="!selectedType" @click="openCreateItem">新增字典项</Button></div></CardHeader>
            <CardContent>
              <p v-if="itemError" role="alert" class="mb-3 text-sm text-destructive">{{ itemError }} <Button size="sm" variant="outline" @click="loadItems()">重试</Button></p>
              <div v-if="itemLoading" role="status" class="py-8 text-center text-sm text-muted-foreground">正在加载字典项…</div>
              <div v-else-if="!selectedType" class="py-8 text-center text-sm text-muted-foreground">请先选择字典类型</div>
              <div v-else-if="!itemError && !itemRows.length" class="py-8 text-center text-sm text-muted-foreground">该类型暂无字典项</div>
              <div v-else-if="!itemError" class="overflow-x-auto rounded-md border">
                <table class="w-full min-w-[700px] text-left text-sm">
                  <thead class="bg-muted/50 text-muted-foreground"><tr><th class="px-3 py-2 font-medium">字典值</th><th class="px-3 py-2 font-medium">字典标签</th><th class="px-3 py-2 font-medium">排序</th><th class="px-3 py-2 font-medium">状态</th><th class="px-3 py-2 font-medium">操作</th></tr></thead>
                  <tbody><tr v-for="item in itemRows" :key="item.id" class="border-t"><td class="px-3 py-2 font-mono text-xs">{{ item.itemValue }}</td><td class="px-3 py-2"><div class="font-medium">{{ item.itemLabel }}</div><div class="text-xs text-muted-foreground">{{ item.description || "" }}</div></td><td class="px-3 py-2"><Input v-model.number="item.sortOrder" type="number" min="0" class="h-8 w-24" :aria-label="`${item.itemLabel}排序`" :disabled="!canUpdate" /></td><td class="px-3 py-2"><Badge :variant="item.status === 1 ? 'default' : 'secondary'">{{ item.status === 1 ? "启用" : "停用" }}</Badge></td><td class="px-3 py-2"><div class="flex gap-1"><Button v-if="canUpdate" size="sm" variant="outline" @click="openEditItem(item)">编辑</Button><Button v-if="canUpdate" size="sm" variant="ghost" @click="toggleItemStatus(item)">{{ item.status === 1 ? "停用" : "启用" }}</Button><Button v-if="canDelete" size="sm" variant="ghost" class="text-destructive" @click="removeItem(item)">删除</Button></div></td></tr></tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>

    <div v-if="typeEditorOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="typeEditorOpen = false">
      <section role="dialog" aria-modal="true" aria-labelledby="dict-type-dialog-title" class="w-full max-w-lg rounded-lg border bg-background p-5 shadow-lg"><h2 id="dict-type-dialog-title" class="text-lg font-semibold">{{ typeEditorMode === "create" ? "新增字典类型" : "编辑字典类型" }}</h2>
        <form class="mt-4 space-y-4" @submit.prevent="saveType"><div class="space-y-1.5"><Label for="dict-type-code">字典编码</Label><Input id="dict-type-code" v-model="typeForm.dictCode" required maxlength="64" /></div><div class="space-y-1.5"><Label for="dict-type-name">字典名称</Label><Input id="dict-type-name" v-model="typeForm.dictName" required maxlength="128" /></div><div class="space-y-1.5"><Label for="dict-type-description">说明</Label><textarea id="dict-type-description" v-model="typeForm.description" maxlength="255" rows="2" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></div><label class="flex items-center gap-2 text-sm"><input v-model="typeForm.status" type="checkbox" :true-value="1" :false-value="0" />类型启用</label><p v-if="actionError" role="alert" class="text-sm text-destructive">{{ actionError }}</p><div class="flex justify-end gap-2"><Button type="button" variant="outline" @click="typeEditorOpen = false">取消</Button><Button type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存" }}</Button></div></form>
      </section>
    </div>

    <div v-if="itemEditorOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="itemEditorOpen = false">
      <section role="dialog" aria-modal="true" aria-labelledby="dict-item-dialog-title" class="w-full max-w-lg rounded-lg border bg-background p-5 shadow-lg"><h2 id="dict-item-dialog-title" class="text-lg font-semibold">{{ itemEditorMode === "create" ? "新增字典项" : "编辑字典项" }} · {{ selectedType?.dictName }}</h2>
        <form class="mt-4 space-y-4" @submit.prevent="saveItem"><div class="space-y-1.5"><Label for="dict-item-value">字典值</Label><Input id="dict-item-value" v-model="itemForm.itemValue" required maxlength="64" /></div><div class="space-y-1.5"><Label for="dict-item-label">字典标签</Label><Input id="dict-item-label" v-model="itemForm.itemLabel" required maxlength="128" /></div><div class="grid gap-3 sm:grid-cols-2"><div class="space-y-1.5"><Label for="dict-item-order">排序号</Label><Input id="dict-item-order" v-model.number="itemForm.sortOrder" type="number" min="0" required /></div><label class="flex items-center gap-2 self-end pb-2 text-sm"><input v-model="itemForm.status" type="checkbox" :true-value="1" :false-value="0" />字典项启用</label></div><div class="space-y-1.5"><Label for="dict-item-description">说明</Label><textarea id="dict-item-description" v-model="itemForm.description" maxlength="255" rows="2" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></div><p v-if="actionError" role="alert" class="text-sm text-destructive">{{ actionError }}</p><div class="flex justify-end gap-2"><Button type="button" variant="outline" @click="itemEditorOpen = false">取消</Button><Button type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存" }}</Button></div></form>
      </section>
    </div>
  </main>
</template>
