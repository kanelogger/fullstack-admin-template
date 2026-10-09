<script setup lang="ts">
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

defineOptions({ name: "SystemMenu" });

type PermissionOption = { key: string; description: string };
type MenuRow = ManagedMenu & { depth: number };

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
const { restore: restoreEditorFocus } = useDialogReturnFocus(editorOpen);
const { restore: restoreRoleAssignmentFocus } = useDialogReturnFocus(roleAssignmentOpen);
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
    (route) => !menus.value.some((menu) => menu.routeKey === route.routeKey && menu.id !== form.id)
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
</script>

<template>
  <main class="space-y-4 p-4" data-testid="menu-management">
    <Card>
      <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>菜单管理</CardTitle>
        <Button v-if="canCreate" data-testid="create-menu" @click="openCreate()">新增菜单</Button>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex flex-wrap items-end gap-3">
          <Field class="min-w-56 flex-1 gap-2">
            <FieldLabel for="menu-filter">筛选菜单</FieldLabel>
            <Input id="menu-filter" v-model="searchText" placeholder="名称、路由或权限键" />
          </Field>
          <label class="flex h-9 items-center gap-2 text-sm"
            ><Checkbox
              :model-value="showInactive"
              @update:model-value="showInactive = $event === true"
            />显示停用项</label
          >
          <Button variant="outline" @click="loadMenus">刷新</Button>
        </div>

        <Alert variant="destructive" v-if="actionError"
          ><AlertDescription>{{ actionError }}</AlertDescription></Alert
        >
        <Alert variant="destructive" v-if="loadError"
          ><AlertDescription>{{ loadError }}</AlertDescription></Alert
        >
        <div v-if="loading" role="status" class="py-8 text-center text-sm text-muted-foreground">
          正在加载菜单…
        </div>
        <div v-else-if="loadError" class="py-5 text-center">
          <Button variant="outline" @click="loadMenus">重试</Button>
        </div>
        <div v-else-if="!visibleRows.length" class="py-8 text-center text-sm text-muted-foreground">
          {{ menus.length ? "没有符合条件的菜单" : "暂无菜单" }}
        </div>
        <div v-else class="overflow-x-auto rounded-md border">
          <Table class="w-full min-w-[980px] text-left">
            <TableHeader
              ><TableRow>
                <TableHead>名称</TableHead><TableHead>类型 / RouteKey</TableHead
                ><TableHead>路由</TableHead><TableHead>权限键</TableHead><TableHead>排序</TableHead
                ><TableHead>显示 / 状态</TableHead><TableHead>操作</TableHead>
              </TableRow></TableHeader
            >
            <TableBody
              ><TableRow v-for="menu in visibleRows" :key="menu.id">
                <TableCell
                  ><span :style="{ paddingLeft: `${menu.depth * 20}px` }" class="font-medium"
                    >{{ menu.depth ? "└ " : "" }}{{ menu.title }}</span
                  ><span v-if="menu.icon" class="ml-2 text-xs text-muted-foreground">{{
                    menu.icon
                  }}</span></TableCell
                >
                <TableCell
                  ><Badge variant="outline">{{ menu.kind === "group" ? "目录" : "页面" }}</Badge
                  ><code v-if="menu.routeKey" class="ml-2 font-mono text-xs">{{
                    menu.routeKey
                  }}</code></TableCell
                >
                <TableCell class="font-mono">{{ menu.path }}</TableCell>
                <TableCell class="font-mono">{{ menu.requiredPermissionKey ?? "—" }}</TableCell>
                <TableCell>{{ menu.sortOrder }}</TableCell>
                <TableCell
                  ><Badge :variant="menu.isVisible ? 'default' : 'secondary'">{{
                    menu.isVisible ? "显示" : "隐藏"
                  }}</Badge
                  ><Badge :variant="menu.isActive ? 'outline' : 'destructive'" class="ml-1">{{
                    menu.isActive ? "启用" : "停用"
                  }}</Badge></TableCell
                >
                <TableCell
                  ><div class="flex flex-wrap gap-1.5">
                    <Button
                      v-if="canCreate"
                      size="sm"
                      variant="outline"
                      @click="openCreate(menu.id)"
                      >新增子级</Button
                    >
                    <Button v-if="canUpdate" size="sm" variant="outline" @click="openEdit(menu)"
                      >编辑</Button
                    >
                    <Button
                      v-if="canReadRoles && canAssignRoles && menu.kind === 'route'"
                      size="sm"
                      variant="outline"
                      @click="openRoleAssignment(menu)"
                      >授权角色</Button
                    >
                    <Button
                      v-if="canUpdate"
                      size="sm"
                      variant="ghost"
                      @click="toggleMenuVisibility(menu)"
                      >{{ menu.isVisible ? "隐藏" : "显示" }}</Button
                    >
                    <Button
                      v-if="canUpdate"
                      size="sm"
                      variant="ghost"
                      @click="toggleMenuStatus(menu)"
                      >{{ menu.isActive ? "停用" : "启用" }}</Button
                    >
                    <Button
                      v-if="canDelete"
                      size="sm"
                      variant="ghost"
                      class="text-destructive"
                      @click="removeMenu(menu)"
                      >删除</Button
                    >
                  </div></TableCell
                >
              </TableRow></TableBody
            >
          </Table>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="editorOpen"
      ><DialogContent
        class="max-h-[92vh] w-full sm:max-w-2xl overflow-y-auto"
        :aria-describedby="undefined"
        @close-auto-focus="restoreEditorFocus"
      >
        <DialogHeader>
          <DialogTitle>{{ editorMode === "create" ? "新增菜单" : "编辑菜单" }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="saveMenuForm">
          <FieldGroup class="mt-4 grid gap-4 sm:grid-cols-2">
            <Field class="gap-2"
              ><FieldLabel for="menu-title">菜单名称</FieldLabel
              ><Input id="menu-title" v-model="form.title" required maxlength="128"
            /></Field>
            <Field class="gap-2"
              ><FieldLabel for="menu-kind">菜单类型</FieldLabel
              ><NativeSelect
                wrapper-class="w-full"
                id="menu-kind"
                v-model="form.kind"
                class="h-9 w-full"
                ><NativeSelectOption value="group">目录</NativeSelectOption
                ><NativeSelectOption value="route">页面</NativeSelectOption></NativeSelect
              ></Field
            >
            <Field class="gap-2"
              ><FieldLabel for="menu-parent">父级菜单</FieldLabel
              ><NativeSelect
                wrapper-class="w-full"
                id="menu-parent"
                v-model="form.parentId"
                class="h-9 w-full"
                ><NativeSelectOption value="">顶级目录</NativeSelectOption
                ><NativeSelectOption
                  v-for="item in parentOptions"
                  :key="item.id"
                  :value="item.id"
                  >{{ item.title }}</NativeSelectOption
                ></NativeSelect
              ></Field
            >
            <Field class="gap-2"
              ><FieldLabel for="menu-icon">图标标识</FieldLabel
              ><Input
                id="menu-icon"
                v-model="form.icon"
                placeholder="可选的图标 key"
                maxlength="128"
            /></Field>
            <template v-if="form.kind === 'route'">
              <Field class="gap-2 sm:col-span-2"
                ><FieldLabel for="menu-route-key">本地页面</FieldLabel
                ><NativeSelect
                  wrapper-class="w-full"
                  id="menu-route-key"
                  v-model="form.routeKey"
                  required
                  class="h-9 w-full"
                  @update:model-value="selectRegisteredRoute"
                  ><NativeSelectOption value="" disabled>选择未使用的已注册页面</NativeSelectOption
                  ><NativeSelectOption
                    v-for="route in availableRoutes"
                    :key="route.routeKey"
                    :value="route.routeKey"
                    >{{ route.label }} · {{ route.routeKey }}</NativeSelectOption
                  ></NativeSelect
                >
                <p class="text-xs text-muted-foreground">
                  每个 RouteKey
                  只绑定一条菜单；页面组件由前端固定注册表决定，服务端不能指定组件路径。
                </p></Field
              >
              <Field class="gap-2"
                ><FieldLabel for="menu-path">路由地址</FieldLabel
                ><Input id="menu-path" v-model="form.path" required placeholder="/system/users"
              /></Field>
              <Field class="gap-2"
                ><FieldLabel for="menu-required-permission">访问权限键</FieldLabel
                ><NativeSelect
                  wrapper-class="w-full"
                  id="menu-required-permission"
                  v-model="form.requiredPermissionKey"
                  required
                  class="h-9 w-full"
                  ><NativeSelectOption value="" disabled>选择访问权限</NativeSelectOption
                  ><NativeSelectOption
                    v-for="item in permissionOptions"
                    :key="item.key"
                    :value="item.key"
                    >{{ item.key }} · {{ item.description }}</NativeSelectOption
                  ></NativeSelect
                ></Field
              >
            </template>
            <Field v-else class="gap-2"
              ><FieldLabel for="menu-group-path">目录路径</FieldLabel
              ><Input id="menu-group-path" v-model="form.path" placeholder="/system"
            /></Field>
            <Field class="gap-2"
              ><FieldLabel for="menu-order">排序</FieldLabel
              ><Input
                id="menu-order"
                v-model.number="form.sortOrder"
                type="number"
                min="0"
                max="100000"
                required
            /></Field>
            <div class="flex flex-wrap items-center gap-5 self-end pb-2 text-sm">
              <label class="flex items-center gap-2"
                ><Switch
                  :model-value="form.isVisible"
                  @update:model-value="form.isVisible = $event === true"
                />菜单可见</label
              ><label class="flex items-center gap-2"
                ><Switch
                  :model-value="form.isActive"
                  @update:model-value="form.isActive = $event === true"
                />菜单启用</label
              >
            </div>
            <Alert variant="destructive" v-if="actionError" class="sm:col-span-2"
              ><AlertDescription>{{ actionError }}</AlertDescription></Alert
            >
            <div class="flex justify-end gap-2 sm:col-span-2">
              <DialogClose as-child
                ><Button type="button" variant="outline">取消</Button></DialogClose
              ><Button type="submit" :disabled="saving">{{
                saving ? "保存中…" : "保存菜单"
              }}</Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent></Dialog
    >

    <Dialog v-model:open="roleAssignmentOpen"
      ><DialogContent
        class="max-h-[90vh] w-full sm:max-w-xl overflow-y-auto"
        @close-auto-focus="restoreRoleAssignmentFocus"
      >
        <DialogHeader>
          <DialogTitle>菜单授权角色 · {{ editingMenu?.title }}</DialogTitle>
          <DialogDescription v-if="menuRoleCatalog">
            权限键 <code class="font-mono">{{ menuRoleCatalog.permissionKey }}</code>
            <span v-if="menuRoleCatalog.sharedMenuCount > 1"
              >，此键由 {{ menuRoleCatalog.sharedMenuCount }} 个菜单共享，授权会同时生效。</span
            >
          </DialogDescription>
        </DialogHeader>
        <p
          v-if="roleAssignmentLoading"
          role="status"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          正在读取角色授权…
        </p>
        <fieldset v-else-if="menuRoleCatalog" class="mt-4 space-y-3 rounded-md border p-3">
          <legend class="px-1 text-sm font-medium">可以访问此权限键的角色</legend>
          <label
            v-for="role in menuRoleCatalog.roles"
            :key="role.id"
            class="flex items-center gap-2 text-sm"
          >
            <Checkbox
              :model-value="role.code === 'SUPER_ADMIN' || selectedMenuRoleIds.includes(role.id)"
              :disabled="role.code === 'SUPER_ADMIN' || !role.isActive || !canAssignRoles"
              @update:model-value="toggleMenuRole(role, $event === true)"
            />
            <span
              >{{ role.name }}
              <code class="ml-1 font-mono text-xs text-muted-foreground">{{
                role.code
              }}</code></span
            >
            <Badge v-if="role.code === 'SUPER_ADMIN'" variant="outline" class="ml-auto"
              >系统授予</Badge
            >
            <Badge v-else-if="role.isSystem" variant="outline" class="ml-auto">模板角色</Badge>
            <Badge v-else-if="!role.isActive" variant="secondary" class="ml-auto">停用</Badge>
          </label>
        </fieldset>
        <Alert variant="destructive" v-if="roleAssignmentError" class="mt-3"
          ><AlertDescription>{{ roleAssignmentError }}</AlertDescription></Alert
        >
        <div class="mt-5 flex justify-end gap-2">
          <DialogClose as-child><Button variant="outline">关闭</Button></DialogClose>
          <Button
            v-if="canAssignRoles"
            :disabled="roleAssignmentSaving || roleAssignmentLoading || !menuRoleCatalog"
            @click="saveMenuRoleAssignment"
            >{{ roleAssignmentSaving ? "保存中…" : "保存角色授权" }}</Button
          >
        </div>
      </DialogContent></Dialog
    >

    <Alert variant="destructive" v-if="!canRead"
      ><AlertDescription>当前账号没有菜单读取权限。</AlertDescription></Alert
    >
  </main>
</template>
