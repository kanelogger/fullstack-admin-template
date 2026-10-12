<script setup lang="ts">
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useDictionariesPage } from "@/features/dictionaries/use-dictionaries-page";

defineOptions({ name: "SystemDict" });

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
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
} = useDictionariesPage();
/* eslint-enable @typescript-eslint/no-unused-vars */
const { restore: restoreTypeEditorOpenFocus } = useDialogReturnFocus(typeEditorOpen);
const { restore: restoreItemEditorOpenFocus } = useDialogReturnFocus(itemEditorOpen);
</script>

<template>
  <main class="space-y-4 p-4" data-testid="dictionary-management">
    <Card>
      <CardHeader class="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>数据字典</CardTitle>
        <Button v-if="canCreate" data-testid="create-dictionary-type" @click="openCreateType"
          >新增类型</Button
        >
      </CardHeader>
      <CardContent class="space-y-4">
        <form @submit.prevent="searchTypes">
          <FieldGroup class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_auto]">
            <Field class="gap-2"
              ><FieldLabel for="dict-code-filter">字典编码</FieldLabel
              ><Input id="dict-code-filter" v-model="typeCodeFilter" placeholder="按编码筛选"
            /></Field>
            <Field class="gap-2"
              ><FieldLabel for="dict-name-filter">字典名称</FieldLabel
              ><Input id="dict-name-filter" v-model="typeNameFilter" placeholder="按名称筛选"
            /></Field>
            <Field class="gap-2"
              ><FieldLabel for="dict-status-filter">状态</FieldLabel
              ><NativeSelect
                wrapper-class="w-full"
                id="dict-status-filter"
                v-model="typeStatusFilter"
                class="h-9 w-full"
                ><NativeSelectOption value="all">全部</NativeSelectOption
                ><NativeSelectOption value="1">启用</NativeSelectOption
                ><NativeSelectOption value="0">停用</NativeSelectOption></NativeSelect
              ></Field
            >
            <div class="flex items-end"><Button type="submit" variant="outline">筛选</Button></div>
          </FieldGroup>
        </form>
        <Alert variant="destructive" v-if="actionError"
          ><AlertDescription>{{ actionError }}</AlertDescription></Alert
        >
        <Alert variant="destructive" v-if="typeError"
          ><AlertDescription>{{ typeError }}</AlertDescription></Alert
        >
        <div
          v-if="typeLoading"
          role="status"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          正在加载字典…
        </div>
        <div v-else-if="typeError" class="text-center">
          <Button variant="outline" @click="loadTypes">重试</Button>
        </div>
        <div v-else class="grid gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(560px,1.4fr)]">
          <Card class="min-w-0">
            <CardHeader class="flex flex-row items-center justify-between gap-2"
              ><CardTitle class="text-base">字典类型</CardTitle
              ><span class="text-xs text-muted-foreground">{{ typeTotal }} 条</span></CardHeader
            >
            <CardContent class="space-y-3">
              <div v-if="!typeRows.length" class="py-8 text-center text-sm text-muted-foreground">
                暂无字典类型
              </div>
              <div v-else class="overflow-x-auto rounded-md border">
                <Table class="w-full min-w-[520px] text-left">
                  <TableHeader
                    ><TableRow
                      ><TableHead>编码 / 名称</TableHead><TableHead>状态</TableHead
                      ><TableHead>操作</TableHead></TableRow
                    ></TableHeader
                  >
                  <TableBody
                    ><TableRow
                      v-for="type in typeRows"
                      :key="type.id"
                      :class="[
                        'cursor-pointer border-t',
                        selectedTypeId === type.id ? 'bg-accent/50' : ''
                      ]"
                      @click="selectType(type)"
                    >
                      <TableCell
                        ><div class="font-mono text-xs">{{ type.dictCode }}</div>
                        <div class="font-medium">{{ type.dictName }}</div></TableCell
                      >
                      <TableCell
                        ><Badge :variant="type.status === 1 ? 'default' : 'secondary'">{{
                          type.status === 1 ? "启用" : "停用"
                        }}</Badge></TableCell
                      >
                      <TableCell
                        ><div class="flex gap-1" @click.stop>
                          <Button
                            v-if="canUpdate"
                            size="sm"
                            variant="outline"
                            @click="openEditType(type)"
                            >编辑</Button
                          ><Button
                            v-if="canUpdate"
                            size="sm"
                            variant="ghost"
                            @click="toggleTypeStatus(type)"
                            >{{ type.status === 1 ? "停用" : "启用" }}</Button
                          ><Button
                            v-if="canDelete"
                            size="sm"
                            variant="ghost"
                            class="text-destructive"
                            @click="removeType(type)"
                            >删除</Button
                          >
                        </div></TableCell
                      >
                    </TableRow></TableBody
                  >
                </Table>
              </div>
              <div class="flex items-center justify-end gap-2 text-xs">
                <Button
                  size="sm"
                  variant="outline"
                  :disabled="typePage <= 1"
                  @click="
                    typePage--;
                    loadTypes();
                  "
                  >上一页</Button
                ><span>第 {{ typePage }} / {{ typePageCount }} 页</span
                ><Button
                  size="sm"
                  variant="outline"
                  :disabled="typePage >= typePageCount"
                  @click="
                    typePage++;
                    loadTypes();
                  "
                  >下一页</Button
                >
                <NativeSelect
                  v-model.number="typePageSize"
                  aria-label="每页类型数"
                  class="h-8"
                  @update:model-value="
                    typePage = 1;
                    loadTypes();
                  "
                  ><NativeSelectOption :value="10">10</NativeSelectOption
                  ><NativeSelectOption :value="20">20</NativeSelectOption
                  ><NativeSelectOption :value="50">50</NativeSelectOption></NativeSelect
                >
              </div>
            </CardContent>
          </Card>

          <Card class="min-w-0">
            <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3"
              ><div>
                <CardTitle class="text-base">{{ selectedType?.dictName ?? "字典项" }}</CardTitle>
                <p class="text-xs text-muted-foreground">
                  {{ selectedType?.dictCode ?? "选择一个字典类型查看字典项" }}
                </p>
              </div>
              <div class="flex gap-2">
                <Button
                  v-if="canUpdate"
                  variant="outline"
                  :disabled="!selectedType || !itemRows.length"
                  @click="saveItemOrder"
                  >保存排序</Button
                ><Button v-if="canCreate" :disabled="!selectedType" @click="openCreateItem"
                  >新增字典项</Button
                >
              </div></CardHeader
            >
            <CardContent>
              <Alert variant="destructive" v-if="itemError" class="mb-3"
                ><AlertDescription
                  >{{ itemError }}
                  <Button size="sm" variant="outline" @click="loadItems()"
                    >重试</Button
                  ></AlertDescription
                ></Alert
              >
              <div
                v-if="itemLoading"
                role="status"
                class="py-8 text-center text-sm text-muted-foreground"
              >
                正在加载字典项…
              </div>
              <div v-else-if="!selectedType" class="py-8 text-center text-sm text-muted-foreground">
                请先选择字典类型
              </div>
              <div
                v-else-if="!itemError && !itemRows.length"
                class="py-8 text-center text-sm text-muted-foreground"
              >
                该类型暂无字典项
              </div>
              <div v-else-if="!itemError" class="overflow-x-auto rounded-md border">
                <Table class="w-full min-w-[700px] text-left">
                  <TableHeader
                    ><TableRow
                      ><TableHead>字典值</TableHead><TableHead>字典标签</TableHead
                      ><TableHead>排序</TableHead><TableHead>状态</TableHead
                      ><TableHead>操作</TableHead></TableRow
                    ></TableHeader
                  >
                  <TableBody
                    ><TableRow v-for="item in itemRows" :key="item.id"
                      ><TableCell class="font-mono">{{ item.itemValue }}</TableCell
                      ><TableCell
                        ><div class="font-medium">{{ item.itemLabel }}</div>
                        <div class="text-xs text-muted-foreground">
                          {{ item.description || "" }}
                        </div></TableCell
                      ><TableCell
                        ><Input
                          v-model.number="item.sortOrder"
                          type="number"
                          min="0"
                          class="h-8 w-24"
                          :aria-label="`${item.itemLabel}排序`"
                          :disabled="!canUpdate" /></TableCell
                      ><TableCell
                        ><Badge :variant="item.status === 1 ? 'default' : 'secondary'">{{
                          item.status === 1 ? "启用" : "停用"
                        }}</Badge></TableCell
                      ><TableCell
                        ><div class="flex gap-1">
                          <Button
                            v-if="canUpdate"
                            size="sm"
                            variant="outline"
                            @click="openEditItem(item)"
                            >编辑</Button
                          ><Button
                            v-if="canUpdate"
                            size="sm"
                            variant="ghost"
                            @click="toggleItemStatus(item)"
                            >{{ item.status === 1 ? "停用" : "启用" }}</Button
                          ><Button
                            v-if="canDelete"
                            size="sm"
                            variant="ghost"
                            class="text-destructive"
                            @click="removeItem(item)"
                            >删除</Button
                          >
                        </div></TableCell
                      ></TableRow
                    ></TableBody
                  >
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="typeEditorOpen"
      ><DialogContent
        @close-auto-focus="restoreTypeEditorOpenFocus"
        class="w-full max-w-lg"
        :aria-describedby="undefined"
        ><DialogHeader
          ><DialogTitle>{{
            typeEditorMode === "create" ? "新增字典类型" : "编辑字典类型"
          }}</DialogTitle></DialogHeader
        >
        <form @submit.prevent="saveType">
          <FieldGroup class="mt-4 gap-4"
            ><Field class="gap-2"
              ><FieldLabel for="dict-type-code">字典编码</FieldLabel
              ><Input
                id="dict-type-code"
                v-model="typeForm.dictCode"
                required
                maxlength="64" /></Field
            ><Field class="gap-2"
              ><FieldLabel for="dict-type-name">字典名称</FieldLabel
              ><Input
                id="dict-type-name"
                v-model="typeForm.dictName"
                required
                maxlength="128" /></Field
            ><Field class="gap-2"
              ><FieldLabel for="dict-type-description">说明</FieldLabel
              ><Textarea
                id="dict-type-description"
                v-model="typeForm.description"
                maxlength="255"
                rows="2"
                class="w-full" /></Field
            ><label class="flex items-center gap-2 text-sm"
              ><Switch
                :model-value="typeForm.status === 1"
                @update:model-value="typeForm.status = $event === true ? 1 : 0"
              />类型启用</label
            ><Alert variant="destructive" v-if="actionError"
              ><AlertDescription>{{ actionError }}</AlertDescription></Alert
            >
            <div class="flex justify-end gap-2">
              <DialogClose as-child
                ><Button type="button" variant="outline">取消</Button></DialogClose
              ><Button type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存" }}</Button>
            </div></FieldGroup
          >
        </form>
      </DialogContent></Dialog
    >

    <Dialog v-model:open="itemEditorOpen"
      ><DialogContent
        @close-auto-focus="restoreItemEditorOpenFocus"
        class="w-full max-w-lg"
        :aria-describedby="undefined"
        ><DialogHeader
          ><DialogTitle
            >{{ itemEditorMode === "create" ? "新增字典项" : "编辑字典项" }} ·
            {{ selectedType?.dictName }}</DialogTitle
          ></DialogHeader
        >
        <form @submit.prevent="saveItem">
          <FieldGroup class="mt-4 gap-4"
            ><Field class="gap-2"
              ><FieldLabel for="dict-item-value">字典值</FieldLabel
              ><Input
                id="dict-item-value"
                v-model="itemForm.itemValue"
                required
                maxlength="64" /></Field
            ><Field class="gap-2"
              ><FieldLabel for="dict-item-label">字典标签</FieldLabel
              ><Input id="dict-item-label" v-model="itemForm.itemLabel" required maxlength="128"
            /></Field>
            <div class="grid gap-3 sm:grid-cols-2">
              <Field class="gap-2"
                ><FieldLabel for="dict-item-order">排序号</FieldLabel
                ><Input
                  id="dict-item-order"
                  v-model.number="itemForm.sortOrder"
                  type="number"
                  min="0"
                  required /></Field
              ><label class="flex items-center gap-2 self-end pb-2 text-sm"
                ><Switch
                  :model-value="itemForm.status === 1"
                  @update:model-value="itemForm.status = $event === true ? 1 : 0"
                />字典项启用</label
              >
            </div>
            <Field class="gap-2"
              ><FieldLabel for="dict-item-description">说明</FieldLabel
              ><Textarea
                id="dict-item-description"
                v-model="itemForm.description"
                maxlength="255"
                rows="2"
                class="w-full" /></Field
            ><Alert variant="destructive" v-if="actionError"
              ><AlertDescription>{{ actionError }}</AlertDescription></Alert
            >
            <div class="flex justify-end gap-2">
              <DialogClose as-child
                ><Button type="button" variant="outline">取消</Button></DialogClose
              ><Button type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存" }}</Button>
            </div></FieldGroup
          >
        </form>
      </DialogContent></Dialog
    >
  </main>
</template>
