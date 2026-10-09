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
import { requestConfirmation } from "@/composables/use-confirmation";
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
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Department, Post } from "@template/contracts/organization";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import {
  deleteDepartment,
  deletePost,
  getDepartments,
  getPosts,
  listDepartmentOptions,
  saveDepartment,
  savePost
} from "./organization.service";

type Kind = "department" | "post";
type Status = 0 | 1;
type Row = {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  status: Status;
  description: string | null;
};

const props = defineProps<{ kind: Kind }>();
const permissions = computed(() => new Set(usePermissionStoreHook().permissionKeys));
const resource = computed(() => (props.kind === "department" ? "departments" : "posts"));
const label = computed(() => (props.kind === "department" ? "部门" : "岗位"));
const codeLabel = computed(() => (props.kind === "department" ? "部门编码" : "岗位编码"));
const nameLabel = computed(() => (props.kind === "department" ? "部门名称" : "岗位名称"));
const canRead = computed(() => permissions.value.has(`organization.${resource.value}.read`));
const canCreate = computed(() => permissions.value.has(`organization.${resource.value}.create`));
const canUpdate = computed(() => permissions.value.has(`organization.${resource.value}.update`));
const canDelete = computed(() => permissions.value.has(`organization.${resource.value}.delete`));

const loading = ref(false);
const saving = ref(false);
const rows = ref<Row[]>([]);
const departmentOptions = ref<Department[]>([]);
const total = ref(0);
const loadError = ref("");
const actionError = ref("");
const page = ref(1);
const pageSize = ref(10);
const codeFilter = ref("");
const nameFilter = ref("");
const statusFilter = ref<"all" | "0" | "1">("all");
const editorOpen = ref(false);
const { restore: restoreEditorFocus } = useDialogReturnFocus(editorOpen);

const editorMode = ref<"create" | "edit">("create");
const form = reactive({
  id: "" as string | undefined,
  code: "",
  name: "",
  parentId: "",
  status: 1 as Status,
  description: ""
});

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const departmentById = computed(
  () => new Map(departmentOptions.value.map((department) => [department.id, department]))
);

const selectableParents = computed(() =>
  departmentOptions.value
    .filter(
      (department) =>
        department.id !== form.id &&
        !isDepartmentDescendant(department.id, form.id, departmentById.value)
    )
    .sort((left, right) =>
      departmentPath(left.deptName, left.parentId, left.id).localeCompare(
        departmentPath(right.deptName, right.parentId, right.id),
        "zh-CN"
      )
    )
);

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function toRow(value: Department | Post): Row {
  return "deptCode" in value
    ? {
        id: value.id,
        code: value.deptCode,
        name: value.deptName,
        parentId: value.parentId,
        status: value.status,
        description: value.description
      }
    : {
        id: value.id,
        code: value.postCode,
        name: value.postName,
        parentId: null,
        status: value.status,
        description: value.description
      };
}

function isDepartmentDescendant(
  candidateId: string,
  ancestorId: string | undefined,
  byId: Map<string, Department>
): boolean {
  if (!ancestorId) return false;
  let parentId = byId.get(candidateId)?.parentId ?? null;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (parentId === ancestorId) return true;
    visited.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return false;
}

function departmentPath(name: string, parentId: string | null, currentId?: string): string {
  const path = [name];
  const visited = new Set<string>(currentId ? [currentId] : []);
  let currentParentId = parentId;
  while (currentParentId) {
    if (visited.has(currentParentId)) {
      path.unshift("循环关系");
      break;
    }
    visited.add(currentParentId);
    const parent = departmentById.value.get(currentParentId);
    if (!parent) {
      path.unshift("未知上级部门");
      break;
    }
    path.unshift(parent.deptName);
    currentParentId = parent.parentId;
  }
  return path.join(" / ");
}

async function loadRows() {
  if (!canRead.value) {
    rows.value = [];
    total.value = 0;
    return;
  }
  loading.value = true;
  loadError.value = "";
  try {
    const commonFilters = {
      page: page.value,
      pageSize: pageSize.value,
      status: statusFilter.value === "all" ? undefined : (Number(statusFilter.value) as Status)
    };
    const result =
      props.kind === "department"
        ? await getDepartments({
            ...commonFilters,
            deptCode: codeFilter.value,
            deptName: nameFilter.value
          })
        : await getPosts({
            ...commonFilters,
            postCode: codeFilter.value,
            postName: nameFilter.value
          });
    if (props.kind === "department") {
      departmentOptions.value = await listDepartmentOptions();
    }
    rows.value = result.items.map(toRow);
    total.value = result.total;
  } catch (error) {
    rows.value = [];
    total.value = 0;
    loadError.value = errorText(error, `${label.value}列表加载失败`);
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  void loadRows();
}

function resetForm() {
  Object.assign(form, {
    id: undefined,
    code: "",
    name: "",
    parentId: "",
    status: 1 as Status,
    description: ""
  });
  actionError.value = "";
}

function openCreate() {
  editorMode.value = "create";
  resetForm();
  editorOpen.value = true;
}

function openEdit(row: Row) {
  editorMode.value = "edit";
  Object.assign(form, {
    id: row.id,
    code: row.code,
    name: row.name,
    parentId: row.parentId ?? "",
    status: row.status,
    description: row.description ?? ""
  });
  actionError.value = "";
  editorOpen.value = true;
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  actionError.value = "";
  const common = {
    ...(form.id ? { id: form.id } : {}),
    status: form.status,
    description: form.description.trim() || null
  };
  try {
    if (props.kind === "department") {
      await saveDepartment({
        ...common,
        parentId: form.parentId || null,
        deptCode: form.code,
        deptName: form.name
      });
    } else {
      await savePost({
        ...common,
        postCode: form.code,
        postName: form.name
      });
    }
    editorOpen.value = false;
    await loadRows();
  } catch (error) {
    actionError.value = errorText(error, `${label.value}保存失败`);
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(row: Row) {
  actionError.value = "";
  try {
    const common = {
      id: row.id,
      status: row.status === 1 ? 0 : 1,
      description: row.description
    };
    if (props.kind === "department") {
      await saveDepartment({
        ...common,
        parentId: row.parentId,
        deptCode: row.code,
        deptName: row.name
      });
    } else {
      await savePost({ ...common, postCode: row.code, postName: row.name });
    }
    await loadRows();
  } catch (error) {
    actionError.value = errorText(error, `${label.value}状态更新失败`);
  }
}

async function remove(row: Row) {
  if (!(await requestConfirmation(`确认删除${label.value}“${row.name}”？`))) return;
  actionError.value = "";
  try {
    if (props.kind === "department") await deleteDepartment(row.id);
    else await deletePost(row.id);
    await loadRows();
  } catch (error) {
    actionError.value = errorText(error, `${label.value}删除失败`);
  }
}

function changePage(nextPage: number) {
  page.value = Math.min(Math.max(1, nextPage), pageCount.value);
  void loadRows();
}

onMounted(() => void loadRows());
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
