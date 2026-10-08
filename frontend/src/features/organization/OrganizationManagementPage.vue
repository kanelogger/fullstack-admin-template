<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
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
const resource = computed(() => props.kind === "department" ? "departments" : "posts");
const label = computed(() => props.kind === "department" ? "部门" : "岗位");
const codeLabel = computed(() => props.kind === "department" ? "部门编码" : "岗位编码");
const nameLabel = computed(() => props.kind === "department" ? "部门名称" : "岗位名称");
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
const departmentById = computed(() => new Map(departmentOptions.value.map(department => [department.id, department])));

const selectableParents = computed(() => departmentOptions.value
  .filter(department => department.id !== form.id && !isDepartmentDescendant(department.id, form.id, departmentById.value))
  .sort((left, right) => departmentPath(left.deptName, left.parentId, left.id)
    .localeCompare(departmentPath(right.deptName, right.parentId, right.id), "zh-CN")));

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

function isDepartmentDescendant(candidateId: string, ancestorId: string | undefined, byId: Map<string, Department>): boolean {
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
      status: statusFilter.value === "all" ? undefined : Number(statusFilter.value) as Status
    };
    const result = props.kind === "department"
      ? await getDepartments({ ...commonFilters, deptCode: codeFilter.value, deptName: nameFilter.value })
      : await getPosts({ ...commonFilters, postCode: codeFilter.value, postName: nameFilter.value });
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
      await saveDepartment({ ...common, parentId: row.parentId, deptCode: row.code, deptName: row.name });
    } else {
      await savePost({ ...common, postCode: row.code, postName: row.name });
    }
    await loadRows();
  } catch (error) {
    actionError.value = errorText(error, `${label.value}状态更新失败`);
  }
}

async function remove(row: Row) {
  if (!window.confirm(`确认删除${label.value}“${row.name}”？`)) return;
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
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-sm font-medium text-primary">系统管理</p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight">{{ label }}管理</h1>
      </div>
      <Button v-if="canCreate" data-testid="create-organization" @click="openCreate">
        新增{{ label }}
      </Button>
    </header>

    <Card>
      <CardHeader>
        <CardTitle class="text-base">筛选{{ label }}</CardTitle>
        <CardDescription>按编码、名称和状态查找{{ label }}。</CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <form class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_auto]" @submit.prevent="search">
          <div class="space-y-1.5">
            <Label for="organization-code-filter">{{ codeLabel }}</Label>
            <Input id="organization-code-filter" v-model="codeFilter" :placeholder="`搜索${codeLabel}`" />
          </div>
          <div class="space-y-1.5">
            <Label for="organization-name-filter">{{ nameLabel }}</Label>
            <Input id="organization-name-filter" v-model="nameFilter" :placeholder="`搜索${nameLabel}`" />
          </div>
          <div class="space-y-1.5">
            <Label for="organization-status-filter">状态</Label>
            <select
              id="organization-status-filter"
              v-model="statusFilter"
              class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="all">全部</option>
              <option value="1">启用</option>
              <option value="0">停用</option>
            </select>
          </div>
          <div class="flex items-end gap-2">
            <Button type="submit" variant="outline">查询</Button>
            <Button
              type="button"
              variant="ghost"
              @click="codeFilter = ''; nameFilter = ''; statusFilter = 'all'; search()"
            >
              重置
            </Button>
          </div>
        </form>

        <p v-if="actionError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {{ actionError }}
        </p>
        <p v-if="!canRead" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          当前账号没有读取{{ label }}的权限。
        </p>
        <div v-else-if="loading" role="status" class="py-10 text-center text-sm text-muted-foreground">
          正在加载{{ label }}…
        </div>
        <div v-else-if="loadError" class="space-y-3 rounded-md border border-destructive/40 p-4 text-center">
          <p role="alert" class="text-sm text-destructive">{{ loadError }}</p>
          <Button variant="outline" @click="loadRows">重试</Button>
        </div>
        <div v-else-if="!rows.length" role="status" class="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">
          {{ total ? "当前页没有数据" : `暂无${label}数据` }}
        </div>
        <div v-else class="overflow-x-auto rounded-md border">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="bg-muted/50 text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">{{ codeLabel }}</th>
                <th class="px-3 py-2 font-medium">{{ nameLabel }}</th>
                <th v-if="kind === 'department'" class="px-3 py-2 font-medium">部门层级</th>
                <th class="px-3 py-2 font-medium">说明</th>
                <th class="px-3 py-2 font-medium">状态</th>
                <th class="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id" class="border-t">
                <td class="px-3 py-3 font-mono text-xs">{{ row.code }}</td>
                <td class="px-3 py-3 font-medium">{{ row.name }}</td>
                <td v-if="kind === 'department'" class="px-3 py-3 text-muted-foreground">{{ departmentPath(row.name, row.parentId, row.id) }}</td>
                <td class="px-3 py-3 text-muted-foreground">{{ row.description || "—" }}</td>
                <td class="px-3 py-3">
                  <Badge :variant="row.status === 1 ? 'default' : 'secondary'">
                    {{ row.status === 1 ? "启用" : "停用" }}
                  </Badge>
                </td>
                <td class="px-3 py-3">
                  <div class="flex flex-wrap gap-2">
                    <Button v-if="canUpdate" size="sm" variant="outline" @click="openEdit(row)">编辑</Button>
                    <Button v-if="canUpdate" size="sm" variant="ghost" @click="toggleStatus(row)">
                      {{ row.status === 1 ? "停用" : "启用" }}
                    </Button>
                    <Button v-if="canDelete" size="sm" variant="destructive" @click="remove(row)">删除</Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="canRead && !loading && !loadError" class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>共 {{ total }} 条，第 {{ page }} / {{ pageCount }} 页</span>
          <div class="flex items-center gap-2">
            <Label :for="`${kind}-page-size`">每页</Label>
            <select
              :id="`${kind}-page-size`"
              v-model.number="pageSize"
              class="h-9 rounded-md border border-input bg-background px-2"
              @change="search"
            >
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
            <Button size="sm" variant="outline" :disabled="page <= 1" @click="changePage(page - 1)">上一页</Button>
            <Button size="sm" variant="outline" :disabled="page >= pageCount" @click="changePage(page + 1)">下一页</Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <div v-if="editorOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4" @click.self="editorOpen = false">
      <section role="dialog" aria-modal="true" :aria-labelledby="`${kind}-editor-title`" class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border bg-card text-card-foreground shadow-xl">
        <form class="space-y-4 p-5" @submit.prevent="save">
          <header>
            <h2 :id="`${kind}-editor-title`" class="text-lg font-semibold">
              {{ editorMode === "create" ? `新增${label}` : `编辑${label}` }}
            </h2>
            <p class="mt-1 text-sm text-muted-foreground">保存前会由数据库再次校验字段、权限和引用约束。</p>
          </header>
          <p v-if="actionError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {{ actionError }}
          </p>
          <div class="space-y-1.5">
            <Label :for="`${kind}-code`">{{ codeLabel }}</Label>
            <Input :id="`${kind}-code`" v-model="form.code" required maxlength="64" />
          </div>
          <div class="space-y-1.5">
            <Label :for="`${kind}-name`">{{ nameLabel }}</Label>
            <Input :id="`${kind}-name`" v-model="form.name" required maxlength="128" />
          </div>
          <div v-if="kind === 'department'" class="space-y-1.5">
            <Label for="department-parent">上级部门</Label>
            <select
              id="department-parent"
              v-model="form.parentId"
              class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">无上级部门</option>
              <option v-for="department in selectableParents" :key="department.id" :value="department.id">
                {{ departmentPath(department.deptName, department.parentId, department.id) }}
              </option>
            </select>
          </div>
          <div class="space-y-1.5">
            <Label :for="`${kind}-description`">说明</Label>
            <textarea
              :id="`${kind}-description`"
              v-model="form.description"
              maxlength="255"
              rows="3"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div class="flex items-center gap-2">
            <input :id="`${kind}-active`" v-model="form.status" type="checkbox" :true-value="1" :false-value="0" class="size-4 accent-primary" />
            <Label :for="`${kind}-active`">启用</Label>
          </div>
          <footer class="flex justify-end gap-2">
            <Button type="button" variant="outline" :disabled="saving" @click="editorOpen = false">取消</Button>
            <Button type="submit" :disabled="saving || !canCreate && editorMode === 'create' || !canUpdate && editorMode === 'edit'">
              {{ saving ? "保存中…" : "保存" }}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  </main>
</template>
