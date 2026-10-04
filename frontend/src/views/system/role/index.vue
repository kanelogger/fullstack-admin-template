<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedPermission, ManagedRole } from "@/contracts/role-management";
import {
  deleteRole,
  getRoleCatalog,
  replaceRolePermissions,
  saveRole
} from "@/features/roles/roles.service";
import { useUserStoreHook } from "@/store/modules/user";

defineOptions({ name: "SystemRole" });

const userStore = useUserStoreHook();
const permissionSet = computed(() => new Set(userStore.permissions));
const canRead = computed(() => permissionSet.value.has("administration.roles.read"));
const canCreate = computed(() => permissionSet.value.has("administration.roles.create"));
const canUpdate = computed(() => permissionSet.value.has("administration.roles.update"));
const canDelete = computed(() => permissionSet.value.has("administration.roles.delete"));
const canAssign = computed(() => permissionSet.value.has("administration.roles.assign_permissions"));

const loading = ref(false);
const saving = ref(false);
const roles = ref<ManagedRole[]>([]);
const permissions = ref<ManagedPermission[]>([]);
const loadError = ref("");
const actionError = ref("");
const searchName = ref("");
const searchCode = ref("");
const statusFilter = ref<"all" | "active" | "inactive">("all");
const page = ref(1);
const pageSize = ref(10);
const editorOpen = ref(false);
const permissionEditorOpen = ref(false);
const editorMode = ref<"create" | "edit">("create");
const editingRole = ref<ManagedRole | null>(null);
const selectedPermissionKeys = ref<string[]>([]);

const form = reactive({
  id: "" as string | undefined,
  code: "",
  name: "",
  description: "",
  isActive: true
});

const filteredRoles = computed(() => {
  const name = searchName.value.trim().toLocaleLowerCase();
  const code = searchCode.value.trim().toLocaleLowerCase();
  return roles.value.filter(role =>
    (!name || role.name.toLocaleLowerCase().includes(name)) &&
    (!code || role.code.toLocaleLowerCase().includes(code)) &&
    (statusFilter.value === "all" ||
      (statusFilter.value === "active" ? role.isActive : !role.isActive))
  );
});
const totalPages = computed(() => Math.max(1, Math.ceil(filteredRoles.value.length / pageSize.value)));
const pageRoles = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filteredRoles.value.slice(start, start + pageSize.value);
});
const groupedPermissions = computed(() => {
  const groups = new Map<string, ManagedPermission[]>();
  for (const permission of permissions.value) {
    const groupName = permission.key.split(".")[0] ?? "other";
    groups.set(groupName, [...(groups.get(groupName) ?? []), permission]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
});

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function loadRoles() {
  loading.value = true;
  loadError.value = "";
  try {
    const catalog = await getRoleCatalog();
    roles.value = catalog.roles;
    permissions.value = catalog.permissions;
    page.value = Math.min(page.value, totalPages.value);
  } catch (error) {
    roles.value = [];
    permissions.value = [];
    loadError.value = errorText(error, "角色目录读取失败，请检查登录状态和角色权限。");
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  Object.assign(form, {
    id: undefined,
    code: "",
    name: "",
    description: "",
    isActive: true
  });
  actionError.value = "";
}

function openCreate() {
  editorMode.value = "create";
  editingRole.value = null;
  resetForm();
  editorOpen.value = true;
}

function openEdit(role: ManagedRole) {
  editorMode.value = "edit";
  editingRole.value = role;
  Object.assign(form, {
    id: role.id,
    code: role.code,
    name: role.name,
    description: role.description ?? "",
    isActive: role.isActive
  });
  actionError.value = "";
  editorOpen.value = true;
}

async function saveRoleMetadata() {
  if (saving.value) return;
  actionError.value = "";
  saving.value = true;
  try {
    const saved = await saveRole({
      ...(form.id ? { id: form.id } : {}),
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      isActive: form.isActive
    });
    editorOpen.value = false;
    await loadRoles();
    if (editorMode.value === "create") {
      actionError.value = "";
    }
    // Keep the server-returned identity explicit; BIGINT values remain strings.
    void saved.id;
  } catch (error) {
    actionError.value = errorText(error, "角色保存失败。");
  } finally {
    saving.value = false;
  }
}

function openPermissionEditor(role: ManagedRole) {
  editingRole.value = role;
  selectedPermissionKeys.value = [...role.permissionKeys];
  actionError.value = "";
  permissionEditorOpen.value = true;
}

function togglePermission(key: string, checked: boolean) {
  selectedPermissionKeys.value = checked
    ? [...new Set([...selectedPermissionKeys.value, key])]
    : selectedPermissionKeys.value.filter(value => value !== key);
}

async function savePermissions() {
  if (!editingRole.value || saving.value) return;
  actionError.value = "";
  saving.value = true;
  try {
    await replaceRolePermissions({
      roleId: editingRole.value.id,
      permissionKeys: selectedPermissionKeys.value
    });
    permissionEditorOpen.value = false;
    await loadRoles();
  } catch (error) {
    actionError.value = errorText(error, "角色权限保存失败。");
  } finally {
    saving.value = false;
  }
}

async function toggleActive(role: ManagedRole) {
  actionError.value = "";
  try {
    await saveRole({
      id: role.id,
      code: role.code,
      name: role.name,
      description: role.description,
      isActive: !role.isActive
    });
    await loadRoles();
  } catch (error) {
    actionError.value = errorText(error, "角色状态更新失败。");
  }
}

async function removeRole(role: ManagedRole) {
  if (role.isSystem) return;
  if (!window.confirm(`确认删除角色“${role.name}”？`)) return;
  actionError.value = "";
  try {
    await deleteRole(role.id);
    await loadRoles();
  } catch (error) {
    actionError.value = errorText(error, "角色删除失败。");
  }
}

function updateSearch() {
  page.value = 1;
}

onMounted(loadRoles);
</script>

<template>
  <main class="space-y-4 p-4" data-testid="role-management">
    <Card>
      <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>角色管理</CardTitle>
        <Button v-if="canCreate" data-testid="create-role" @click="openCreate">新增角色</Button>
      </CardHeader>
      <CardContent class="space-y-4">
        <form class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_180px_auto]" @submit.prevent="updateSearch">
          <div class="space-y-1.5">
            <Label for="role-name-filter">角色名称</Label>
            <Input id="role-name-filter" v-model="searchName" placeholder="按名称筛选" @input="updateSearch" />
          </div>
          <div class="space-y-1.5">
            <Label for="role-code-filter">角色编码</Label>
            <Input id="role-code-filter" v-model="searchCode" placeholder="按编码筛选" @input="updateSearch" />
          </div>
          <div class="space-y-1.5">
            <Label for="role-status-filter">状态</Label>
            <select id="role-status-filter" v-model="statusFilter" class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" @change="updateSearch">
              <option value="all">全部</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
          <div class="flex items-end">
            <Button type="submit" variant="outline">筛选</Button>
          </div>
        </form>

        <p v-if="actionError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{{ actionError }}</p>
        <p v-if="loadError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{{ loadError }}</p>
        <div v-if="loading" role="status" class="py-8 text-center text-sm text-muted-foreground">正在加载角色…</div>
        <div v-else-if="loadError" class="py-5 text-center">
          <Button variant="outline" @click="loadRoles">重试</Button>
        </div>
        <div v-else-if="!pageRoles.length" class="py-8 text-center text-sm text-muted-foreground">{{ roles.length ? "没有符合筛选条件的角色" : "暂无角色" }}</div>
        <div v-else class="overflow-x-auto rounded-md border">
          <table class="w-full min-w-[820px] text-left text-sm">
            <thead class="bg-muted/50 text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">角色名称</th>
                <th class="px-3 py-2 font-medium">角色编码</th>
                <th class="px-3 py-2 font-medium">授权权限</th>
                <th class="px-3 py-2 font-medium">用户数</th>
                <th class="px-3 py-2 font-medium">状态</th>
                <th class="px-3 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="role in pageRoles" :key="role.id" class="border-t">
                <td class="px-3 py-3">
                  <div class="font-medium">{{ role.name }}</div>
                  <div class="text-xs text-muted-foreground">{{ role.description || "—" }}</div>
                </td>
                <td class="px-3 py-3 font-mono text-xs">{{ role.code }}</td>
                <td class="px-3 py-3">{{ role.permissionKeys.length }}</td>
                <td class="px-3 py-3">{{ role.userCount }}</td>
                <td class="px-3 py-3">
                  <Badge :variant="role.isActive ? 'default' : 'secondary'">{{ role.isActive ? "启用" : "停用" }}</Badge>
                  <Badge v-if="role.isSystem" variant="outline" class="ml-1">系统角色</Badge>
                </td>
                <td class="px-3 py-3">
                  <div class="flex flex-wrap gap-2">
                    <Button v-if="canUpdate" size="sm" variant="outline" @click="openEdit(role)">编辑</Button>
                    <Button v-if="canAssign && role.code !== 'SUPER_ADMIN'" size="sm" variant="outline" @click="openPermissionEditor(role)">权限</Button>
                    <span v-else-if="canAssign && role.code === 'SUPER_ADMIN'" class="self-center text-xs text-muted-foreground">系统权限</span>
                    <Button v-if="canUpdate && !role.isSystem" size="sm" variant="ghost" @click="toggleActive(role)">{{ role.isActive ? "停用" : "启用" }}</Button>
                    <Button v-if="canDelete && !role.isSystem" size="sm" variant="ghost" class="text-destructive" @click="removeRole(role)">删除</Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="filteredRoles.length > pageSize" class="flex items-center justify-end gap-3 text-sm">
          <span class="text-muted-foreground">共 {{ filteredRoles.length }} 个角色</span>
          <Button size="sm" variant="outline" :disabled="page <= 1" @click="page--">上一页</Button>
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <Button size="sm" variant="outline" :disabled="page >= totalPages" @click="page++">下一页</Button>
          <select v-model.number="pageSize" aria-label="每页条数" class="h-8 rounded-md border bg-background px-2" @change="page = 1">
            <option :value="10">10 条</option><option :value="20">20 条</option><option :value="50">50 条</option>
          </select>
        </div>
      </CardContent>
    </Card>

    <div v-if="editorOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="editorOpen = false">
      <section role="dialog" aria-modal="true" aria-labelledby="role-editor-title" class="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border bg-background p-5 shadow-lg">
        <h2 id="role-editor-title" class="text-lg font-semibold">{{ editorMode === "create" ? "新增角色" : "编辑角色" }}</h2>
        <form class="mt-4 space-y-4" @submit.prevent="saveRoleMetadata">
          <div class="space-y-1.5">
            <Label for="role-code">角色编码</Label>
            <Input id="role-code" v-model="form.code" :disabled="editorMode === 'edit'" placeholder="例如 SUPPORT_AGENT" autocomplete="off" />
            <p class="text-xs text-muted-foreground">使用稳定的大写编码；编码创建后不可修改。</p>
          </div>
          <div class="space-y-1.5">
            <Label for="role-name">角色名称</Label>
            <Input id="role-name" v-model="form.name" required maxlength="128" />
          </div>
          <div class="space-y-1.5">
            <Label for="role-description">说明</Label>
            <textarea id="role-description" v-model="form.description" rows="3" maxlength="2000" class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          </div>
          <label v-if="editorMode === 'edit' && editingRole?.code !== 'SUPER_ADMIN'" class="flex items-center gap-2 text-sm">
            <input v-model="form.isActive" type="checkbox" /> 角色启用
          </label>
          <p v-else-if="editorMode === 'edit'" class="text-xs text-muted-foreground">SUPER_ADMIN 必须保持启用。</p>
          <p v-if="actionError" role="alert" class="text-sm text-destructive">{{ actionError }}</p>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="outline" @click="editorOpen = false">取消</Button>
            <Button type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存角色" }}</Button>
          </div>
        </form>
      </section>
    </div>

    <div v-if="permissionEditorOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="permissionEditorOpen = false">
      <section role="dialog" aria-modal="true" aria-labelledby="role-permissions-title" class="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border bg-background p-5 shadow-lg">
        <h2 id="role-permissions-title" class="text-lg font-semibold">角色权限 · {{ editingRole?.name }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">授权键由服务端用于数据访问控制；隐藏菜单或按钮不构成权限边界。</p>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <fieldset v-for="[group, entries] in groupedPermissions" :key="group" class="space-y-2 rounded-md border p-3">
            <legend class="px-1 text-sm font-semibold">{{ group }}</legend>
            <label v-for="permission in entries" :key="permission.key" class="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                :checked="selectedPermissionKeys.includes(permission.key)"
                :aria-label="`${permission.key} ${permission.description}`"
                class="mt-1"
                @change="togglePermission(permission.key, ($event.target as HTMLInputElement).checked)"
              />
              <span><code class="font-mono text-xs">{{ permission.key }}</code><span class="block text-muted-foreground">{{ permission.description }}</span></span>
            </label>
          </fieldset>
        </div>
        <p v-if="actionError" role="alert" class="mt-3 text-sm text-destructive">{{ actionError }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <Button variant="outline" @click="permissionEditorOpen = false">取消</Button>
          <Button :disabled="saving" @click="savePermissions">{{ saving ? "保存中…" : "保存权限" }}</Button>
        </div>
      </section>
    </div>

    <p v-if="!canRead" class="sr-only" role="alert">当前账号没有角色读取权限。</p>
  </main>
</template>
