<script setup lang="ts">
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSystemConfigPage } from "@/features/configuration/use-system-config-page";

defineOptions({ name: "SystemConfig" });

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
  permissionSet,
  canUpdate,
  rows,
  loading,
  saving,
  loadError,
  actionError,
  editorOpen,
  editorMode,
  editingConfig,
  page,
  pageSize,
  total,
  codeFilter,
  nameFilter,
  statusFilter,
  valueTypes,
  pageCount,
  form,
  errorText,
  loadConfigurations,
  search,
  clearForm,
  openCreate,
  openEdit,
  saveConfig,
  toggleStatus,
  removeConfig
} = useSystemConfigPage();
/* eslint-enable @typescript-eslint/no-unused-vars */
const { restore: restoreEditorOpenFocus } = useDialogReturnFocus(editorOpen);
</script>

<template>
  <main class="space-y-4 p-4" data-testid="system-configuration">
    <Dialog v-model:open="editorOpen">
      <Card>
        <CardHeader class="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>系统配置</CardTitle>
          <DialogTrigger v-if="canUpdate" as-child>
            <Button data-testid="create-system-config" @click="openCreate">新增配置</Button>
          </DialogTrigger>
        </CardHeader>
        <CardContent class="space-y-4">
          <form @submit.prevent="search">
            <FieldGroup class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_auto]">
              <Field class="gap-2"
                ><FieldLabel for="config-code-filter">配置编码</FieldLabel
                ><Input id="config-code-filter" v-model="codeFilter" placeholder="按编码筛选"
              /></Field>
              <Field class="gap-2"
                ><FieldLabel for="config-name-filter">配置名称</FieldLabel
                ><Input id="config-name-filter" v-model="nameFilter" placeholder="按名称筛选"
              /></Field>
              <Field class="gap-2"
                ><FieldLabel for="config-status-filter">状态</FieldLabel
                ><NativeSelect
                  wrapper-class="w-full"
                  id="config-status-filter"
                  v-model="statusFilter"
                  class="h-9 w-full"
                  ><NativeSelectOption value="all">全部</NativeSelectOption
                  ><NativeSelectOption value="1">启用</NativeSelectOption
                  ><NativeSelectOption value="0">停用</NativeSelectOption></NativeSelect
                ></Field
              >
              <div class="flex items-end">
                <Button type="submit" variant="outline">筛选</Button>
              </div>
            </FieldGroup>
          </form>
          <Alert variant="destructive" v-if="actionError"
            ><AlertDescription>{{ actionError }}</AlertDescription></Alert
          >
          <Alert variant="destructive" v-if="loadError"
            ><AlertDescription>{{ loadError }}</AlertDescription></Alert
          >
          <div v-if="loading" role="status" class="py-8 text-center text-sm text-muted-foreground">
            正在加载配置…
          </div>
          <div v-else-if="loadError" class="py-5 text-center">
            <Button variant="outline" @click="loadConfigurations">重试</Button>
          </div>
          <div v-else-if="!rows.length" class="py-8 text-center text-sm text-muted-foreground">
            暂无系统配置
          </div>
          <div v-else class="overflow-x-auto rounded-md border">
            <Table class="w-full min-w-[1000px] text-left">
              <TableHeader
                ><TableRow
                  ><TableHead>配置编码</TableHead><TableHead>配置名称</TableHead
                  ><TableHead>配置值</TableHead><TableHead>类型</TableHead
                  ><TableHead>状态</TableHead><TableHead>说明</TableHead
                  ><TableHead>操作</TableHead></TableRow
                ></TableHeader
              >
              <TableBody
                ><TableRow v-for="config in rows" :key="config.id">
                  <TableCell class="font-mono">{{ config.configCode }}</TableCell>
                  <TableCell>{{ config.configName }}</TableCell>
                  <TableCell class="max-w-sm"
                    ><span
                      class="block max-w-[22rem] truncate font-mono text-xs"
                      :title="config.configValue"
                      >{{ config.configValue }}</span
                    ></TableCell
                  >
                  <TableCell>{{ config.valueType }}</TableCell>
                  <TableCell
                    ><Badge :variant="config.status === 1 ? 'default' : 'secondary'">{{
                      config.status === 1 ? "启用" : "停用"
                    }}</Badge></TableCell
                  >
                  <TableCell>{{ config.description || "—" }}</TableCell>
                  <TableCell
                    ><div v-if="canUpdate" class="flex gap-1">
                      <Button size="sm" variant="outline" @click="openEdit(config)">编辑</Button
                      ><Button size="sm" variant="ghost" @click="toggleStatus(config)">{{
                        config.status === 1 ? "停用" : "启用"
                      }}</Button
                      ><Button
                        size="sm"
                        variant="ghost"
                        class="text-destructive"
                        @click="removeConfig(config)"
                        >删除</Button
                      >
                    </div>
                    <span v-else class="text-xs text-muted-foreground">只读</span></TableCell
                  >
                </TableRow></TableBody
              >
            </Table>
          </div>
          <div v-if="total > pageSize" class="flex items-center justify-end gap-3 text-sm">
            <span class="text-muted-foreground">共 {{ total }} 条</span
            ><Button
              size="sm"
              variant="outline"
              :disabled="page <= 1"
              @click="
                page--;
                loadConfigurations();
              "
              >上一页</Button
            ><span>第 {{ page }} / {{ pageCount }} 页</span
            ><Button
              size="sm"
              variant="outline"
              :disabled="page >= pageCount"
              @click="
                page++;
                loadConfigurations();
              "
              >下一页</Button
            ><NativeSelect
              v-model.number="pageSize"
              aria-label="每页配置数"
              class="h-8"
              @update:model-value="
                page = 1;
                loadConfigurations();
              "
              ><NativeSelectOption :value="10">10 条</NativeSelectOption
              ><NativeSelectOption :value="20">20 条</NativeSelectOption
              ><NativeSelectOption :value="50">50 条</NativeSelectOption></NativeSelect
            >
          </div>
        </CardContent>
      </Card>

      <DialogContent
        @close-auto-focus="restoreEditorOpenFocus"
        class="max-h-[92vh] w-full sm:max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{{ editorMode === "create" ? "新增配置" : "编辑配置" }}</DialogTitle>
          <DialogDescription>维护配置值及其类型、状态和说明。</DialogDescription>
        </DialogHeader>
        <form @submit.prevent="saveConfig">
          <FieldGroup class="mt-4 grid gap-4 sm:grid-cols-2">
            <Field class="gap-2"
              ><FieldLabel for="config-code">配置编码</FieldLabel
              ><Input id="config-code" v-model="form.configCode" required maxlength="64"
            /></Field>
            <Field class="gap-2"
              ><FieldLabel for="config-name">配置名称</FieldLabel
              ><Input id="config-name" v-model="form.configName" required maxlength="128"
            /></Field>
            <Field class="gap-2"
              ><FieldLabel for="config-value-type">值类型</FieldLabel
              ><NativeSelect
                wrapper-class="w-full"
                id="config-value-type"
                v-model="form.valueType"
                class="h-9 w-full"
                ><NativeSelectOption
                  v-for="type in valueTypes"
                  :key="type.value"
                  :value="type.value"
                  >{{ type.label }}</NativeSelectOption
                ></NativeSelect
              ></Field
            >
            <Field class="gap-2"
              ><FieldLabel for="config-status">状态</FieldLabel
              ><NativeSelect
                wrapper-class="w-full"
                id="config-status"
                v-model.number="form.status"
                class="h-9 w-full"
                ><NativeSelectOption :value="1">启用</NativeSelectOption
                ><NativeSelectOption :value="0">停用</NativeSelectOption></NativeSelect
              ></Field
            >
            <Field class="gap-2 sm:col-span-2"
              ><FieldLabel for="config-value">配置值</FieldLabel
              ><Textarea
                id="config-value"
                v-model="form.configValue"
                required
                rows="4"
                class="w-full font-mono"
              />
              <p class="text-xs text-muted-foreground">
                此页面维护旧业务系统配置值；部署密钥、服务凭据应留在本机或服务端密钥配置中。
              </p></Field
            >
            <Field class="gap-2 sm:col-span-2"
              ><FieldLabel for="config-description">说明</FieldLabel
              ><Textarea
                id="config-description"
                v-model="form.description"
                rows="2"
                maxlength="255"
                class="w-full"
            /></Field>
            <Alert variant="destructive" v-if="actionError" class="sm:col-span-2"
              ><AlertDescription>{{ actionError }}</AlertDescription></Alert
            >
            <DialogFooter class="sm:col-span-2"
              ><DialogClose as-child
                ><Button type="button" variant="outline">取消</Button></DialogClose
              ><Button type="submit" :disabled="saving">{{
                saving ? "保存中…" : "保存"
              }}</Button></DialogFooter
            >
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  </main>
</template>
