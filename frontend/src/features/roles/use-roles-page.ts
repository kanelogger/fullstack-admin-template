import { requestConfirmation } from "@/composables/use-confirmation";
import { computed, onMounted, reactive, ref } from "vue";
import type { ManagedMenu } from "@template/contracts/menu-management";
import type {
  ManagedPermission,
  ManagedRole,
  RoleMember
} from "@template/contracts/role-management";
import {
  deleteRole,
  getRoleCatalog,
  getRoleMembers,
  replaceRoleAuthorization,
  saveRole
} from "@/features/roles/roles.service";
import { useSessionStoreHook } from "@/stores/modules/session";
import { usePermissionStoreHook } from "@/stores/modules/permission";

export function useRolesPage() {
  const userStore = useSessionStoreHook();
  const permissionSet = computed(() => new Set(usePermissionStoreHook().permissionKeys));
  const canRead = computed(() => permissionSet.value.has("administration.roles.read"));
  const canCreate = computed(() => permissionSet.value.has("administration.roles.create"));
  const canUpdate = computed(() => permissionSet.value.has("administration.roles.update"));
  const canDelete = computed(() => permissionSet.value.has("administration.roles.delete"));
  const canAssign = computed(() =>
    permissionSet.value.has("administration.roles.assign_permissions")
  );

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
  const menuPermissionKeys = computed(
    () =>
      new Set(
        menus.value
          .filter((menu) => menu.kind === "route" && menu.requiredPermissionKey)
          .map((menu) => menu.requiredPermissionKey!)
      )
  );
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
    for (const permission of permissions.value.filter(
      (item) => !menuPermissionKeys.value.has(item.key)
    )) {
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
    selectedMenuPermissionKeys.value = role.permissionKeys.filter((key) =>
      menuPermissionKeys.value.has(key)
    );
    selectedActionPermissionKeys.value = role.permissionKeys.filter(
      (key) => !menuPermissionKeys.value.has(key)
    );
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
      .filter(
        (menu) => descendants.has(menu.id) && menu.kind === "route" && menu.requiredPermissionKey
      )
      .map((menu) => menu.requiredPermissionKey!);
  }

  function menuNodeChecked(menu: ManagedMenu): boolean {
    const keys = descendantMenuKeys(menu.id);
    return keys.length > 0 && keys.every((key) => selectedMenuPermissionKeys.value.includes(key));
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
      : selectedActionPermissionKeys.value.filter((value) => value !== key);
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
    if (!(await requestConfirmation(`确认删除角色“${role.name}”？`))) return;
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

  return {
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    canAssign,
    loading,
    saving,
    roles,
    permissions,
    menus,
    total,
    loadError,
    actionError,
    searchName,
    searchCode,
    statusFilter,
    page,
    pageSize,
    editorOpen,
    permissionEditorOpen,
    memberDialogOpen,
    memberRole,
    memberRows,
    membersLoading,
    memberError,
    memberPage,
    memberPageSize,
    memberTotal,
    editorMode,
    editingRole,
    selectedMenuPermissionKeys,
    selectedActionPermissionKeys,
    form,
    pageRoles,
    totalPages,
    menuRows,
    groupedPermissions,
    loadRoles,
    openCreate,
    openEdit,
    saveRoleMetadata,
    openPermissionEditor,
    descendantMenuKeys,
    menuNodeChecked,
    toggleMenuAuthorization,
    toggleActionPermission,
    saveAuthorization,
    loadMembers,
    openMembers,
    toggleActive,
    removeRole,
    updateSearch,
    changeRolePage
  };
}
