import { requestConfirmation } from "@/composables/use-confirmation";
import { computed, onMounted, reactive, ref } from "vue";
import type { ManagedMenu, ManagedMenuKind } from "@template/contracts/menu-management";
import type { MenuRole, MenuRoleCatalog } from "@template/contracts/role-management";
import {
  deleteMenu,
  getMenuCatalog,
  getMenuPermissionOptions,
  getMenuRoleCatalog,
  replaceMenuRoleAuthorization,
  saveMenu
} from "@/features/menus/menus.service";
import {
  registeredMenuRoutes,
  type RegisteredMenuRouteKey
} from "@/features/menus/menu-routes.registry";
import { useSessionStoreHook } from "@/stores/modules/session";
import { usePermissionStoreHook } from "@/stores/modules/permission";

export type PermissionOption = { key: string; description: string };
export type MenuRow = ManagedMenu & { depth: number };

export function useMenusPage() {
  const userStore = useSessionStoreHook();
  const permissionSet = computed(() => new Set(usePermissionStoreHook().permissionKeys));
  const canRead = computed(() => permissionSet.value.has("administration.menus.read"));
  const canCreate = computed(() => permissionSet.value.has("administration.menus.create"));
  const canUpdate = computed(() => permissionSet.value.has("administration.menus.update"));
  const canDelete = computed(() => permissionSet.value.has("administration.menus.delete"));
  const canReadRoles = computed(() => permissionSet.value.has("administration.roles.read"));
  const canAssignRoles = computed(() =>
    permissionSet.value.has("administration.roles.assign_permissions")
  );

  const menus = ref<ManagedMenu[]>([]);
  const permissionOptions = ref<PermissionOption[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const loadError = ref("");
  const actionError = ref("");
  const searchText = ref("");
  const showInactive = ref(false);
  const editorOpen = ref(false);
  const roleAssignmentOpen = ref(false);
  const roleAssignmentLoading = ref(false);
  const roleAssignmentSaving = ref(false);
  const roleAssignmentError = ref("");
  const editingMenu = ref<ManagedMenu | null>(null);
  const menuRoleCatalog = ref<MenuRoleCatalog | null>(null);
  const selectedMenuRoleIds = ref<string[]>([]);
  const editorMode = ref<"create" | "edit">("create");

  const form = reactive({
    id: "" as string | undefined,
    parentId: "",
    kind: "route" as ManagedMenuKind,
    routeKey: "" as RegisteredMenuRouteKey | "",
    path: "",
    title: "",
    icon: "",
    sortOrder: 0,
    isVisible: true,
    isActive: true,
    requiredPermissionKey: ""
  });

  function errorText(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  function menuDescendantIds(menuId: string): Set<string> {
    const descendants = new Set<string>();
    let frontier = [menuId];
    while (frontier.length) {
      const children = menus.value.filter((menu) => frontier.includes(menu.parentId ?? ""));
      frontier = [];
      for (const child of children) {
        if (!descendants.has(child.id)) {
          descendants.add(child.id);
          frontier.push(child.id);
        }
      }
    }
    return descendants;
  }

  const parentOptions = computed(() => {
    const excluded = new Set<string>();
    if (form.id) {
      excluded.add(form.id);
      for (const id of menuDescendantIds(form.id)) excluded.add(id);
    }
    return menus.value.filter((menu) => !excluded.has(menu.id));
  });
  const availableRoutes = computed(() =>
    registeredMenuRoutes.filter(
      (route) =>
        !menus.value.some((menu) => menu.routeKey === route.routeKey && menu.id !== form.id)
    )
  );

  const visibleRows = computed<MenuRow[]>(() => {
    const byParent = new Map<string | null, ManagedMenu[]>();
    for (const menu of menus.value) {
      if (!showInactive.value && !menu.isActive) continue;
      byParent.set(menu.parentId, [...(byParent.get(menu.parentId) ?? []), menu]);
    }
    for (const siblings of byParent.values())
      siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    const result: MenuRow[] = [];
    const query = searchText.value.trim().toLocaleLowerCase();
    const visit = (parentId: string | null, depth: number) => {
      for (const menu of byParent.get(parentId) ?? []) {
        const matched =
          !query ||
          [menu.title, menu.path, menu.routeKey ?? "", menu.requiredPermissionKey ?? ""].some(
            (value) => value.toLocaleLowerCase().includes(query)
          );
        if (matched) result.push({ ...menu, depth });
        visit(menu.id, depth + 1);
      }
    };
    visit(null, 0);
    return result;
  });

  async function loadMenus() {
    loading.value = true;
    loadError.value = "";
    try {
      const [catalog, permissionResult] = await Promise.all([
        getMenuCatalog(),
        getMenuPermissionOptions()
      ]);
      menus.value = catalog;
      permissionOptions.value = permissionResult;
    } catch (error) {
      menus.value = [];
      permissionOptions.value = [];
      loadError.value = errorText(error, "菜单目录读取失败，请检查菜单表迁移和当前账号权限。");
    } finally {
      loading.value = false;
    }
  }

  function resetForm(parentId = "") {
    Object.assign(form, {
      id: undefined,
      parentId,
      kind: "route",
      routeKey: "",
      path: "",
      title: "",
      icon: "",
      sortOrder: 0,
      isVisible: true,
      isActive: true,
      requiredPermissionKey: ""
    });
    actionError.value = "";
  }

  function openCreate(parentId = "") {
    editorMode.value = "create";
    resetForm(parentId);
    editorOpen.value = true;
  }

  function openEdit(menu: ManagedMenu) {
    editorMode.value = "edit";
    Object.assign(form, {
      id: menu.id,
      parentId: menu.parentId ?? "",
      kind: menu.kind,
      routeKey: (menu.routeKey as RegisteredMenuRouteKey | null) ?? "",
      path: menu.path,
      title: menu.title,
      icon: menu.icon ?? "",
      sortOrder: menu.sortOrder,
      isVisible: menu.isVisible,
      isActive: menu.isActive,
      requiredPermissionKey: menu.requiredPermissionKey ?? ""
    });
    actionError.value = "";
    editorOpen.value = true;
  }

  function selectRegisteredRoute() {
    const route = registeredMenuRoutes.find((item) => item.routeKey === form.routeKey);
    if (!route) return;
    if (!form.path) form.path = route.defaultPath;
    if (!form.title) form.title = route.label;
    if (!form.requiredPermissionKey) form.requiredPermissionKey = route.requiredPermissionKey;
  }

  async function openRoleAssignment(menu: ManagedMenu) {
    if (menu.kind !== "route") return;
    editingMenu.value = menu;
    roleAssignmentOpen.value = true;
    roleAssignmentLoading.value = true;
    roleAssignmentError.value = "";
    try {
      menuRoleCatalog.value = await getMenuRoleCatalog(menu.id);
      selectedMenuRoleIds.value = menuRoleCatalog.value.roles
        .filter((role) => role.authorized && !role.isSystem)
        .map((role) => role.id);
    } catch (error) {
      menuRoleCatalog.value = null;
      roleAssignmentError.value = errorText(error, "菜单角色授权读取失败。");
    } finally {
      roleAssignmentLoading.value = false;
    }
  }

  function toggleMenuRole(role: MenuRole, checked: boolean) {
    if (role.code === "SUPER_ADMIN" || !role.isActive) return;
    selectedMenuRoleIds.value = checked
      ? [...new Set([...selectedMenuRoleIds.value, role.id])]
      : selectedMenuRoleIds.value.filter((id) => id !== role.id);
  }

  async function saveMenuRoleAssignment() {
    if (!editingMenu.value || roleAssignmentSaving.value) return;
    roleAssignmentSaving.value = true;
    roleAssignmentError.value = "";
    try {
      await replaceMenuRoleAuthorization({
        menuId: editingMenu.value.id,
        roleIds: selectedMenuRoleIds.value
      });
      roleAssignmentOpen.value = false;
      await loadMenus();
      await userStore.refreshAuthorization(true);
    } catch (error) {
      roleAssignmentError.value = errorText(error, "菜单角色授权保存失败。");
    } finally {
      roleAssignmentSaving.value = false;
    }
  }

  async function saveMenuForm() {
    if (saving.value) return;
    actionError.value = "";
    saving.value = true;
    try {
      await saveMenu({
        ...(form.id ? { id: form.id } : {}),
        parentId: form.parentId || null,
        kind: form.kind,
        routeKey: form.kind === "route" ? form.routeKey || null : null,
        path: form.path.trim(),
        title: form.title.trim(),
        icon: form.icon.trim() || null,
        sortOrder: Number(form.sortOrder),
        isVisible: form.isVisible,
        isActive: form.isActive,
        requiredPermissionKey: form.kind === "route" ? form.requiredPermissionKey || null : null
      });
      editorOpen.value = false;
      await loadMenus();
      await userStore.refreshAuthorization(true);
    } catch (error) {
      actionError.value = errorText(error, "菜单保存失败。");
    } finally {
      saving.value = false;
    }
  }

  async function toggleMenuStatus(menu: ManagedMenu) {
    actionError.value = "";
    try {
      await saveMenu({
        id: menu.id,
        parentId: menu.parentId,
        kind: menu.kind,
        routeKey: menu.routeKey,
        path: menu.path,
        title: menu.title,
        icon: menu.icon,
        sortOrder: menu.sortOrder,
        isVisible: menu.isVisible,
        isActive: !menu.isActive,
        requiredPermissionKey: menu.requiredPermissionKey
      });
      await loadMenus();
      await userStore.refreshAuthorization(true);
    } catch (error) {
      actionError.value = errorText(error, "菜单状态更新失败。");
    }
  }

  async function toggleMenuVisibility(menu: ManagedMenu) {
    actionError.value = "";
    try {
      await saveMenu({
        id: menu.id,
        parentId: menu.parentId,
        kind: menu.kind,
        routeKey: menu.routeKey,
        path: menu.path,
        title: menu.title,
        icon: menu.icon,
        sortOrder: menu.sortOrder,
        isVisible: !menu.isVisible,
        isActive: menu.isActive,
        requiredPermissionKey: menu.requiredPermissionKey
      });
      await loadMenus();
      await userStore.refreshAuthorization(true);
    } catch (error) {
      actionError.value = errorText(error, "菜单显隐更新失败。");
    }
  }

  async function removeMenu(menu: ManagedMenu) {
    if (!(await requestConfirmation(`确认删除菜单“${menu.title}”？`))) return;
    actionError.value = "";
    try {
      await deleteMenu(menu.id);
      await loadMenus();
      await userStore.refreshAuthorization(true);
    } catch (error) {
      actionError.value = errorText(error, "菜单删除失败。请先处理子菜单或关联路由。");
    }
  }

  onMounted(loadMenus);
  return {
    userStore,
    permissionSet,
    canRead,
    canCreate,
    canUpdate,
    canDelete,
    canReadRoles,
    canAssignRoles,
    menus,
    permissionOptions,
    loading,
    saving,
    loadError,
    actionError,
    searchText,
    showInactive,
    editorOpen,
    roleAssignmentOpen,
    roleAssignmentLoading,
    roleAssignmentSaving,
    roleAssignmentError,
    editingMenu,
    menuRoleCatalog,
    selectedMenuRoleIds,
    editorMode,
    form,
    errorText,
    menuDescendantIds,
    parentOptions,
    availableRoutes,
    visibleRows,
    loadMenus,
    resetForm,
    openCreate,
    openEdit,
    selectRegisteredRoute,
    openRoleAssignment,
    toggleMenuRole,
    saveMenuRoleAssignment,
    saveMenuForm,
    toggleMenuStatus,
    toggleMenuVisibility,
    removeMenu
  };
}
