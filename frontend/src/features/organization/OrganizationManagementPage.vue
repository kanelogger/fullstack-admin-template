<script setup lang="ts">
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOrganizationPage, type Kind } from "@/features/organization/use-organization-page";

const props = defineProps<{ kind: Kind }>();

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
  permissions,
  resource,
  label,
  codeLabel,
  nameLabel,
  canRead,
  canCreate,
  canUpdate,
  canDelete,
  loading,
  saving,
  rows,
  departmentOptions,
  total,
  loadError,
  actionError,
  page,
  pageSize,
  codeFilter,
  nameFilter,
  statusFilter,
  editorOpen,
  restoreEditorFocus,
  editorMode,
  form,
  pageCount,
  departmentById,
  selectableParents,
  errorText,
  toRow,
  isDepartmentDescendant,
  departmentPath,
  loadRows,
  search,
  resetForm,
  openCreate,
  openEdit,
  save,
  toggleStatus,
  remove,
  changePage
} = useOrganizationPage(props);
/* eslint-enable @typescript-eslint/no-unused-vars */
</script>

<template>
  <main class="space-y-4 p-4" :data-testid="`${kind}-management`">
    <Dialog v-model:open="editorOpen">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="text-sm font-medium text-primary">系统管理</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight">{{ label }}管理</h1>
        </div>
        <DialogTrigger v-if="canCreate" as-child>
          <Button data-testid="create-organization" @click="openCreate">新增{{ label }}</Button>
        </DialogTrigger>
      </header>

      <Card>
        <CardHeader>
          <CardTitle class="text-base">筛选{{ label }}</CardTitle>
          <CardDescription>按编码、名称和状态查找{{ label }}。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <form @submit.prevent="search">
            <FieldGroup class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_auto]">
              <Field class="gap-2">
                <FieldLabel for="organization-code-filter">{{ codeLabel }}</FieldLabel>
                <Input
                  id="organization-code-filter"
                  v-model="codeFilter"
                  :placeholder="`搜索${codeLabel}`"
                />
              </Field>
              <Field class="gap-2">
                <FieldLabel for="organization-name-filter">{{ nameLabel }}</FieldLabel>
                <Input
                  id="organization-name-filter"
                  v-model="nameFilter"
                  :placeholder="`搜索${nameLabel}`"
                />
              </Field>
              <Field class="gap-2">
                <FieldLabel for="organization-status-filter">状态</FieldLabel>
                <NativeSelect
                  wrapper-class="w-full"
                  id="organization-status-filter"
                  v-model="statusFilter"
                  class="h-10 w-full"
                >
                  <NativeSelectOption value="all">全部</NativeSelectOption>
                  <NativeSelectOption value="1">启用</NativeSelectOption>
                  <NativeSelectOption value="0">停用</NativeSelectOption>
                </NativeSelect>
              </Field>
              <div class="flex items-end gap-2">
                <Button type="submit" variant="outline">查询</Button>
                <Button
                  type="button"
                  variant="ghost"
                  @click="
                    codeFilter = '';
                    nameFilter = '';
                    statusFilter = 'all';
                    search();
                  "
                >
                  重置
                </Button>
              </div>
            </FieldGroup>
          </form>

          <Alert variant="destructive" v-if="actionError"
            ><AlertDescription>
              {{ actionError }}
            </AlertDescription></Alert
          >
          <Alert variant="destructive" v-if="!canRead"
            ><AlertDescription> 当前账号没有读取{{ label }}的权限。 </AlertDescription></Alert
          >
          <div
            v-else-if="loading"
            role="status"
            class="py-10 text-center text-sm text-muted-foreground"
          >
            正在加载{{ label }}…
          </div>
          <div
            v-else-if="loadError"
            class="space-y-3 rounded-md border border-destructive/40 p-4 text-center"
          >
            <Alert variant="destructive"
              ><AlertDescription>{{ loadError }}</AlertDescription></Alert
            >
            <Button variant="outline" @click="loadRows">重试</Button>
          </div>
          <div
            v-else-if="!rows.length"
            role="status"
            class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
          >
            {{ total ? "当前页没有数据" : `暂无${label}数据` }}
          </div>
          <div v-else class="overflow-x-auto rounded-md border">
            <Table class="w-full min-w-[760px] text-left">
              <TableHeader>
                <TableRow>
                  <TableHead>{{ codeLabel }}</TableHead>
                  <TableHead>{{ nameLabel }}</TableHead>
                  <TableHead v-if="kind === 'department'">部门层级</TableHead>
                  <TableHead>说明</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="row in rows" :key="row.id">
                  <TableCell class="font-mono">{{ row.code }}</TableCell>
                  <TableCell>{{ row.name }}</TableCell>
                  <TableCell v-if="kind === 'department'">{{
                    departmentPath(row.name, row.parentId, row.id)
                  }}</TableCell>
                  <TableCell>{{ row.description || "—" }}</TableCell>
                  <TableCell>
                    <Badge :variant="row.status === 1 ? 'default' : 'secondary'">
                      {{ row.status === 1 ? "启用" : "停用" }}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div class="flex flex-wrap gap-2">
                      <Button v-if="canUpdate" size="sm" variant="outline" @click="openEdit(row)"
                        >编辑</Button
                      >
                      <Button v-if="canUpdate" size="sm" variant="ghost" @click="toggleStatus(row)">
                        {{ row.status === 1 ? "停用" : "启用" }}
                      </Button>
                      <Button v-if="canDelete" size="sm" variant="destructive" @click="remove(row)"
                        >删除</Button
                      >
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <div
            v-if="canRead && !loading && !loadError"
            class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
          >
            <span>共 {{ total }} 条，第 {{ page }} / {{ pageCount }} 页</span>
            <Field class="flex items-center gap-2">
              <FieldLabel :for="`${kind}-page-size`">每页</FieldLabel>
              <NativeSelect
                :id="`${kind}-page-size`"
                v-model.number="pageSize"
                class="h-9"
                @update:model-value="search"
              >
                <NativeSelectOption :value="10">10</NativeSelectOption>
                <NativeSelectOption :value="20">20</NativeSelectOption>
                <NativeSelectOption :value="50">50</NativeSelectOption>
                <NativeSelectOption :value="100">100</NativeSelectOption>
              </NativeSelect>
              <Button
                size="sm"
                variant="outline"
                :disabled="page <= 1"
                @click="changePage(page - 1)"
                >上一页</Button
              >
              <Button
                size="sm"
                variant="outline"
                :disabled="page >= pageCount"
                @click="changePage(page + 1)"
                >下一页</Button
              >
            </Field>
          </div>
        </CardContent>
      </Card>

      <DialogContent
        class="max-h-[90vh] w-full sm:max-w-xl overflow-y-auto"
        @close-auto-focus="restoreEditorFocus"
      >
        <DialogHeader>
          <DialogTitle>
            {{ editorMode === "create" ? `新增${label}` : `编辑${label}` }}
          </DialogTitle>
          <DialogDescription>保存前会由数据库再次校验字段、权限和引用约束。</DialogDescription>
        </DialogHeader>
        <form @submit.prevent="save">
          <FieldGroup class="gap-4 p-5">
            <Alert variant="destructive" v-if="actionError"
              ><AlertDescription>
                {{ actionError }}
              </AlertDescription></Alert
            >
            <Field class="gap-2">
              <FieldLabel :for="`${kind}-code`">{{ codeLabel }}</FieldLabel>
              <Input :id="`${kind}-code`" v-model="form.code" required maxlength="64" />
            </Field>
            <Field class="gap-2">
              <FieldLabel :for="`${kind}-name`">{{ nameLabel }}</FieldLabel>
              <Input :id="`${kind}-name`" v-model="form.name" required maxlength="128" />
            </Field>
            <Field v-if="kind === 'department'" class="gap-2">
              <FieldLabel for="department-parent">上级部门</FieldLabel>
              <NativeSelect
                wrapper-class="w-full"
                id="department-parent"
                v-model="form.parentId"
                class="h-10 w-full"
              >
                <NativeSelectOption value="">无上级部门</NativeSelectOption>
                <NativeSelectOption
                  v-for="department in selectableParents"
                  :key="department.id"
                  :value="department.id"
                >
                  {{ departmentPath(department.deptName, department.parentId, department.id) }}
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field class="gap-2">
              <FieldLabel :for="`${kind}-description`">说明</FieldLabel>
              <Textarea
                :id="`${kind}-description`"
                v-model="form.description"
                maxlength="255"
                rows="3"
                class="w-full"
              />
            </Field>
            <div class="flex items-center gap-2">
              <Switch
                :id="`${kind}-active`"
                :model-value="form.status === 1"
                @update:model-value="form.status = $event === true ? 1 : 0"
              />
              <Label :for="`${kind}-active`">启用</Label>
            </div>
            <DialogFooter>
              <DialogClose as-child
                ><Button type="button" variant="outline" :disabled="saving"
                  >取消</Button
                ></DialogClose
              >
              <Button
                type="submit"
                :disabled="
                  saving ||
                  (!canCreate && editorMode === 'create') ||
                  (!canUpdate && editorMode === 'edit')
                "
              >
                {{ saving ? "保存中…" : "保存" }}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  </main>
</template>
