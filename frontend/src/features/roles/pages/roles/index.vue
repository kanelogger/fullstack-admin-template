<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedMenu } from "@template/contracts/menu-management";
import type { ManagedPermission, ManagedRole, RoleMember } from "@template/contracts/role-management";
import {
  deleteRole,
  getRoleCatalog,
  getRoleMembers,
  replaceRoleAuthorization,
  saveRole
} from "@/features/roles/roles.service";
import { useSessionStoreHook } from "@/stores/modules/session";
import { usePermissionStoreHook } from "@/stores/modules/permission";

defineOptions({ name: "SystemRole" });

const userStore = useSessionStoreHook();
const permissionSet = computed(() => new Set(usePermissionStoreHook().permissionKeys));
const canRead = computed(() => permissionSet.value.has("administration.roles.read"));
const canCreate = computed(() => permissionSet.value.has("administration.roles.create"));
const canUpdate = computed(() => permissionSet.value.has("administration.roles.update"));
const canDelete = computed(() => permissionSet.value.has("administration.roles.delete"));
const canAssign = computed(() => permissionSet.value.has("administration.roles.assign_permissions"));

const loading = ref(false);
const saving = ref(false);
const roles = ref<ManagedRole[]>([]);
const permissions = ref<ManagedPermission[]>([]);
const menus = ref<ManagedMenu[]>([]);
const total = ref(0);
const loadError = ref("");
const actionError = ref("");
const searchName = ref("");
const searchCode = ref("");
const statusFilter = ref<"all" | "active" | "inactive">("all");
const page = ref(1);
const pageSize = ref(10);
const editorOpen = ref(false);
const permissionEditorOpen = ref(false);
const memberDialogOpen = ref(false);
const memberRole = ref<ManagedRole | null>(null);
const memberRows = ref<RoleMember[]>([]);
const membersLoading = ref(false);
const memberError = ref("");
const memberPage = ref(1);
const memberPageSize = ref(10);
const memberTotal = ref(0);
const editorMode = ref<"create" | "edit">("create");
const editingRole = ref<ManagedRole | null>(null);
const selectedMenuPermissionKeys = ref<string[]>([]);
const selectedActionPermissionKeys = ref<string[]>([]);

const form = reactive({
  id: "" as string | undefined,
  code: "",
  name: "",
  description: "",
  isActive: true
});

const pageRoles = computed(() => roles.value);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const menuPermissionKeys = computed(() => new Set(menus.value
  .filter(menu => menu.kind === "route" && menu.requiredPermissionKey)
  .map(menu => menu.requiredPermissionKey!)));
const menuRows = computed(() => {
  const byParent = new Map<string | null, ManagedMenu[]>();
  for (const menu of menus.value) {
    byParent.set(menu.parentId, [...(byParent.get(menu.parentId) ?? []), menu]);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }
  const rows: Array<ManagedMenu & { depth: number }> = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const menu of byParent.get(parentId) ?? []) {
      rows.push({ ...menu, depth });
      visit(menu.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
});
const groupedPermissions = computed(() => {
  const groups = new Map<string, ManagedPermission[]>();
  for (const permission of permissions.value.filter(item => !menuPermissionKeys.value.has(item.key))) {
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
    const catalog = await getRoleCatalog({
      name: searchName.value.trim() || undefined,
      code: searchCode.value.trim() || undefined,
      status: statusFilter.value,
      page: page.value,
      pageSize: pageSize.value
    });
    roles.value = catalog.roles;
    permissions.value = catalog.permissions;
    menus.value = catalog.menus;
    total.value = catalog.total;
    page.value = catalog.page;
  } catch (error) {
    roles.value = [];
    permissions.value = [];
    menus.value = [];
    total.value = 0;
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
    await userStore.refreshAuthorization(true);
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
  selectedMenuPermissionKeys.value = role.permissionKeys.filter(key => menuPermissionKeys.value.has(key));
  selectedActionPermissionKeys.value = role.permissionKeys.filter(key => !menuPermissionKeys.value.has(key));
  actionError.value = "";
  permissionEditorOpen.value = true;
}

function descendantMenuKeys(menuId: string): string[] {
  const descendants = new Set<string>([menuId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const menu of menus.value) {
      if (menu.parentId && descendants.has(menu.parentId) && !descendants.has(menu.id)) {
        descendants.add(menu.id);
        changed = true;
      }
    }
  }
  return menus.value
    .filter(menu => descendants.has(menu.id) && menu.kind === "route" && menu.requiredPermissionKey)
    .map(menu => menu.requiredPermissionKey!);
}

function menuNodeChecked(menu: ManagedMenu): boolean {
  const keys = descendantMenuKeys(menu.id);
  return keys.length > 0 && keys.every(key => selectedMenuPermissionKeys.value.includes(key));
}

function toggleMenuAuthorization(menu: ManagedMenu, checked: boolean) {
  const next = new Set(selectedMenuPermissionKeys.value);
  for (const key of descendantMenuKeys(menu.id)) {
    if (checked) next.add(key);
    else next.delete(key);
  }
  selectedMenuPermissionKeys.value = [...next];
}

function toggleActionPermission(key: string, checked: boolean) {
  selectedActionPermissionKeys.value = checked
    ? [...new Set([...selectedActionPermissionKeys.value, key])]
    : selectedActionPermissionKeys.value.filter(value => value !== key);
}

async function saveAuthorization() {
  if (!editingRole.value || saving.value) return;
  actionError.value = "";
  saving.value = true;
  try {
    await replaceRoleAuthorization({
      roleId: editingRole.value.id,
      menuPermissionKeys: selectedMenuPermissionKeys.value,
      actionPermissionKeys: selectedActionPermissionKeys.value
    });
    permissionEditorOpen.value = false;
    await loadRoles();
    await userStore.refreshAuthorization(true);
  } catch (error) {
    actionError.value = errorText(error, "角色权限保存失败。");
  } finally {
    saving.value = false;
  }
}

async function loadMembers() {
  if (!memberRole.value) return;
  membersLoading.value = true;
  memberError.value = "";
  try {
    const result = await getRoleMembers({
      roleId: memberRole.value.id,
      page: memberPage.value,
      pageSize: memberPageSize.value
    });
    memberRows.value = result.items;
    memberTotal.value = result.total;
  } catch (error) {
    memberRows.value = [];
    memberError.value = errorText(error, "角色成员读取失败。");
  } finally {
    membersLoading.value = false;
  }
}

async function openMembers(role: ManagedRole) {
  memberRole.value = role;
  memberPage.value = 1;
  memberDialogOpen.value = true;
  await loadMembers();
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
    await userStore.refreshAuthorization(true);
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
    await userStore.refreshAuthorization(true);
  } catch (error) {
    actionError.value = errorText(error, "角色删除失败。");
  }
}

function updateSearch() {
  page.value = 1;
  void loadRoles();
}

function changeRolePage(nextPage: number) {
  if (nextPage < 1 || nextPage > totalPages.value) return;
  page.value = nextPage;
  void loadRoles();
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
        <div v-else-if="!pageRoles.length" class="py-8 text-center text-sm text-muted-foreground">{{ total ? "没有符合筛选条件的角色" : "暂无角色" }}</div>
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
                    <Button v-if="canRead" size="sm" variant="outline" @click="openMembers(role)">成员</Button>
                    <Button v-if="canAssign && role.code !== 'SUPER_ADMIN'" size="sm" variant="outline" @click="openPermissionEditor(role)">菜单与权限</Button>
                    <span v-else-if="canAssign && role.code === 'SUPER_ADMIN'" class="self-center text-xs text-muted-foreground">系统权限</span>
                    <Button v-if="canUpdate && !role.isSystem" size="sm" variant="ghost" @click="toggleActive(role)">{{ role.isActive ? "停用" : "启用" }}</Button>
                    <Button v-if="canDelete && !role.isSystem" size="sm" variant="ghost" class="text-destructive" @click="removeRole(role)">删除</Button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="total > pageSize" class="flex items-center justify-end gap-3 text-sm">
          <span class="text-muted-foreground">共 {{ total }} 个角色</span>
          <Button size="sm" variant="outline" :disabled="page <= 1" @click="changeRolePage(page - 1)">上一页</Button>
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <Button size="sm" variant="outline" :disabled="page >= totalPages" @click="changeRolePage(page + 1)">下一页</Button>
          <select v-model.number="pageSize" aria-label="每页条数" class="h-8 rounded-md border bg-background px-2" @change="page = 1; loadRoles()">
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
        <p class="mt-1 text-sm text-muted-foreground">菜单访问由 requiredPermissionKey 决定；按钮操作权限单独保留。同权限键对应的页面会联动授权。</p>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <fieldset class="space-y-2 rounded-md border p-3 md:col-span-2">
            <legend class="px-1 text-sm font-semibold">菜单访问</legend>
            <label v-for="menu in menuRows" :key="menu.id" class="flex items-start gap-2 py-1 text-sm">
              <input
                type="checkbox"
                :checked="menuNodeChecked(menu)"
                :disabled="!menuNodeChecked(menu) && menu.kind === 'group' && descendantMenuKeys(menu.id).length === 0"
                :aria-label="`菜单 ${menu.title}`"
                class="mt-1"
                @change="toggleMenuAuthorization(menu, ($event.target as HTMLInputElement).checked)"
              />
              <span :style="{ paddingLeft: `${menu.depth * 18}px` }">
                <span>{{ menu.kind === "group" ? "目录" : "页面" }} · {{ menu.title }}</span>
                <span v-if="menu.requiredPermissionKey" class="ml-2 font-mono text-xs text-muted-foreground">{{ menu.requiredPermissionKey }}</span>
                <span v-if="menu.kind === 'route' && !menu.isActive" class="ml-2 text-xs text-muted-foreground">停用</span>
              </span>
            </label>
          </fieldset>
          <fieldset v-for="[group, entries] in groupedPermissions" :key="group" class="space-y-2 rounded-md border p-3">
            <legend class="px-1 text-sm font-semibold">操作权限 · {{ group }}</legend>
            <label v-for="permission in entries" :key="permission.key" class="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                :checked="selectedActionPermissionKeys.includes(permission.key)"
                :aria-label="`${permission.key} ${permission.description}`"
                class="mt-1"
                @change="toggleActionPermission(permission.key, ($event.target as HTMLInputElement).checked)"
              />
              <span><code class="font-mono text-xs">{{ permission.key }}</code><span class="block text-muted-foreground">{{ permission.description }}</span></span>
            </label>
          </fieldset>
        </div>
        <p v-if="actionError" role="alert" class="mt-3 text-sm text-destructive">{{ actionError }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <Button variant="outline" @click="permissionEditorOpen = false">取消</Button>
          <Button :disabled="saving" @click="saveAuthorization">{{ saving ? "保存中…" : "保存授权" }}</Button>
        </div>
      </section>
    </div>

    <div v-if="memberDialogOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="memberDialogOpen = false">
      <section role="dialog" aria-modal="true" aria-labelledby="role-members-title" class="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border bg-background p-5 shadow-lg">
        <h2 id="role-members-title" class="text-lg font-semibold">角色成员 · {{ memberRole?.name }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">显示未删除账号；停用账号保留在成员列表中。</p>
        <p v-if="memberError" role="alert" class="mt-3 text-sm text-destructive">{{ memberError }}</p>
        <p v-if="membersLoading" role="status" class="py-8 text-center text-sm text-muted-foreground">正在加载成员…</p>
        <p v-else-if="!memberRows.length" class="py-8 text-center text-sm text-muted-foreground">该角色暂无成员</p>
        <div v-else class="mt-4 overflow-x-auto rounded-md border">
          <table class="w-full min-w-[520px] text-left text-sm">
            <thead class="bg-muted/50 text-muted-foreground"><tr>
              <th class="px-3 py-2 font-medium">工号</th><th class="px-3 py-2 font-medium">登录账号</th><th class="px-3 py-2 font-medium">显示名称</th><th class="px-3 py-2 font-medium">状态</th>
            </tr></thead>
            <tbody><tr v-for="member in memberRows" :key="member.id" class="border-t">
              <td class="px-3 py-2">{{ member.userCode ?? "—" }}</td><td class="px-3 py-2">{{ member.loginName }}</td><td class="px-3 py-2">{{ member.displayName }}</td>
              <td class="px-3 py-2"><Badge :variant="member.isActive ? 'default' : 'secondary'">{{ member.isActive ? "启用" : "停用" }}</Badge></td>
            </tr></tbody>
          </table>
        </div>
        <div class="mt-4 flex items-center justify-end gap-3 text-sm">
          <span class="text-muted-foreground">共 {{ memberTotal }} 名成员 · 第 {{ memberPage }} / {{ Math.max(1, Math.ceil(memberTotal / memberPageSize)) }} 页</span>
          <Button size="sm" variant="outline" :disabled="membersLoading || memberPage <= 1" @click="memberPage--; loadMembers()">上一页</Button>
          <Button size="sm" variant="outline" :disabled="membersLoading || memberPage >= Math.ceil(memberTotal / memberPageSize)" @click="memberPage++; loadMembers()">下一页</Button>
          <Button variant="outline" @click="memberDialogOpen = false">关闭</Button>
        </div>
      </section>
    </div>

    <p v-if="!canRead" class="sr-only" role="alert">当前账号没有角色读取权限。</p>
  </main>
</template>
