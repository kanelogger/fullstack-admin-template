<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedMenu, ManagedMenuKind } from "@/contracts/menu-management";
import { PermissionKeySchema } from "@/contracts/permissions";
import { deleteMenu, getMenuCatalog, saveMenu } from "@/features/menus/menus.service";
import { registeredMenuRoutes, type RegisteredMenuRouteKey } from "@/features/menus/menu-routes.registry";
import { useUserStoreHook } from "@/store/modules/user";

defineOptions({ name: "SystemMenu" });

type PermissionOption = { permission_key: string; description: string };
type MenuRow = ManagedMenu & { depth: number };

const userStore = useUserStoreHook();
const permissionSet = computed(() => new Set(userStore.permissions));
const canRead = computed(() => permissionSet.value.has("administration.menus.read"));
const canCreate = computed(() => permissionSet.value.has("administration.menus.create"));
const canUpdate = computed(() => permissionSet.value.has("administration.menus.update"));
const canDelete = computed(() => permissionSet.value.has("administration.menus.delete"));

const menus = ref<ManagedMenu[]>([]);
const permissionOptions = ref<PermissionOption[]>([]);
const loading = ref(false);
const saving = ref(false);
const loadError = ref("");
const actionError = ref("");
const searchText = ref("");
const showInactive = ref(false);
const editorOpen = ref(false);
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
    const children = menus.value.filter(menu => frontier.includes(menu.parentId ?? ""));
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
  return menus.value.filter(menu => !excluded.has(menu.id));
});
const availableRoutes = computed(() => registeredMenuRoutes.filter(route =>
  !menus.value.some(menu => menu.routeKey === route.routeKey && menu.id !== form.id)
));

const visibleRows = computed<MenuRow[]>(() => {
  const byParent = new Map<string | null, ManagedMenu[]>();
  for (const menu of menus.value) {
    if (!showInactive.value && !menu.isActive) continue;
    byParent.set(menu.parentId, [...(byParent.get(menu.parentId) ?? []), menu]);
  }
  for (const siblings of byParent.values()) siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  const result: MenuRow[] = [];
  const query = searchText.value.trim().toLocaleLowerCase();
  const visit = (parentId: string | null, depth: number) => {
    for (const menu of byParent.get(parentId) ?? []) {
      const matched = !query || [menu.title, menu.path, menu.routeKey ?? "", menu.requiredPermissionKey ?? ""]
        .some(value => value.toLocaleLowerCase().includes(query));
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
      // permission_catalog has no business BIGINT columns and its RLS policy
      // exposes descriptions to authenticated users for permission selection.
      import("@/shared/supabase/client").then(({ getSupabaseClient }) =>
        getSupabaseClient().from("permission_catalog").select("permission_key,description").order("permission_key")
      )
    ]);
    if (permissionResult.error) throw new Error(permissionResult.error.message || "权限目录读取失败");
    menus.value = catalog;
    permissionOptions.value = (permissionResult.data ?? []).map(row => ({
      permission_key: PermissionKeySchema.parse(row.permission_key),
      description: String(row.description)
    }));
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
    routeKey: menu.routeKey as RegisteredMenuRouteKey | null ?? "",
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
  const route = registeredMenuRoutes.find(item => item.routeKey === form.routeKey);
  if (!route) return;
  if (!form.path) form.path = route.defaultPath;
  if (!form.title) form.title = route.label;
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
  } catch (error) {
    actionError.value = errorText(error, "菜单显隐更新失败。");
  }
}

async function removeMenu(menu: ManagedMenu) {
  if (!window.confirm(`确认删除菜单“${menu.title}”？`)) return;
  actionError.value = "";
  try {
    await deleteMenu(menu.id);
    await loadMenus();
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
          <div class="min-w-56 flex-1 space-y-1.5">
            <Label for="menu-filter">筛选菜单</Label>
            <Input id="menu-filter" v-model="searchText" placeholder="名称、路由或权限键" />
          </div>
          <label class="flex h-9 items-center gap-2 text-sm"><input v-model="showInactive" type="checkbox" />显示停用项</label>
          <Button variant="outline" @click="loadMenus">刷新</Button>
        </div>

        <p v-if="actionError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{{ actionError }}</p>
        <p v-if="loadError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{{ loadError }}</p>
        <div v-if="loading" role="status" class="py-8 text-center text-sm text-muted-foreground">正在加载菜单…</div>
        <div v-else-if="loadError" class="py-5 text-center"><Button variant="outline" @click="loadMenus">重试</Button></div>
        <div v-else-if="!visibleRows.length" class="py-8 text-center text-sm text-muted-foreground">{{ menus.length ? "没有符合条件的菜单" : "暂无菜单" }}</div>
        <div v-else class="overflow-x-auto rounded-md border">
          <table class="w-full min-w-[980px] text-left text-sm">
            <thead class="bg-muted/50 text-muted-foreground"><tr>
              <th class="px-3 py-2 font-medium">名称</th><th class="px-3 py-2 font-medium">类型 / RouteKey</th><th class="px-3 py-2 font-medium">路由</th><th class="px-3 py-2 font-medium">权限键</th><th class="px-3 py-2 font-medium">排序</th><th class="px-3 py-2 font-medium">显示 / 状态</th><th class="px-3 py-2 font-medium">操作</th>
            </tr></thead>
            <tbody><tr v-for="menu in visibleRows" :key="menu.id" class="border-t">
              <td class="px-3 py-3"><span :style="{ paddingLeft: `${menu.depth * 20}px` }" class="font-medium">{{ menu.depth ? "└ " : "" }}{{ menu.title }}</span><span v-if="menu.icon" class="ml-2 text-xs text-muted-foreground">{{ menu.icon }}</span></td>
              <td class="px-3 py-3"><Badge variant="outline">{{ menu.kind === "group" ? "目录" : "页面" }}</Badge><code v-if="menu.routeKey" class="ml-2 font-mono text-xs">{{ menu.routeKey }}</code></td>
              <td class="px-3 py-3 font-mono text-xs">{{ menu.path }}</td>
              <td class="px-3 py-3 font-mono text-xs">{{ menu.requiredPermissionKey ?? "—" }}</td>
              <td class="px-3 py-3">{{ menu.sortOrder }}</td>
              <td class="px-3 py-3"><Badge :variant="menu.isVisible ? 'default' : 'secondary'">{{ menu.isVisible ? "显示" : "隐藏" }}</Badge><Badge :variant="menu.isActive ? 'outline' : 'destructive'" class="ml-1">{{ menu.isActive ? "启用" : "停用" }}</Badge></td>
              <td class="px-3 py-3"><div class="flex flex-wrap gap-1.5">
                <Button v-if="canCreate" size="sm" variant="outline" @click="openCreate(menu.id)">新增子级</Button>
                <Button v-if="canUpdate" size="sm" variant="outline" @click="openEdit(menu)">编辑</Button>
                <Button v-if="canUpdate" size="sm" variant="ghost" @click="toggleMenuVisibility(menu)">{{ menu.isVisible ? "隐藏" : "显示" }}</Button>
                <Button v-if="canUpdate" size="sm" variant="ghost" @click="toggleMenuStatus(menu)">{{ menu.isActive ? "停用" : "启用" }}</Button>
                <Button v-if="canDelete" size="sm" variant="ghost" class="text-destructive" @click="removeMenu(menu)">删除</Button>
              </div></td>
            </tr></tbody>
          </table>
        </div>
      </CardContent>
    </Card>

    <div v-if="editorOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="editorOpen = false">
      <section role="dialog" aria-modal="true" aria-labelledby="menu-editor-title" class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-5 shadow-lg">
        <h2 id="menu-editor-title" class="text-lg font-semibold">{{ editorMode === "create" ? "新增菜单" : "编辑菜单" }}</h2>
        <form class="mt-4 grid gap-4 sm:grid-cols-2" @submit.prevent="saveMenuForm">
          <div class="space-y-1.5"><Label for="menu-title">菜单名称</Label><Input id="menu-title" v-model="form.title" required maxlength="128" /></div>
          <div class="space-y-1.5"><Label for="menu-kind">菜单类型</Label><select id="menu-kind" v-model="form.kind" class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="group">目录</option><option value="route">页面</option></select></div>
          <div class="space-y-1.5"><Label for="menu-parent">父级菜单</Label><select id="menu-parent" v-model="form.parentId" class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">顶级目录</option><option v-for="item in parentOptions" :key="item.id" :value="item.id">{{ item.title }}</option></select></div>
          <div class="space-y-1.5"><Label for="menu-icon">图标标识</Label><Input id="menu-icon" v-model="form.icon" placeholder="可选的图标 key" maxlength="128" /></div>
          <template v-if="form.kind === 'route'">
            <div class="space-y-1.5 sm:col-span-2"><Label for="menu-route-key">本地页面</Label><select id="menu-route-key" v-model="form.routeKey" required class="h-9 w-full rounded-md border bg-background px-3 text-sm" @change="selectRegisteredRoute"><option value="" disabled>选择未使用的已注册页面</option><option v-for="route in availableRoutes" :key="route.routeKey" :value="route.routeKey">{{ route.label }} · {{ route.routeKey }}</option></select><p class="text-xs text-muted-foreground">每个 RouteKey 只绑定一条菜单；页面组件由前端固定注册表决定，服务端不能指定组件路径。</p></div>
            <div class="space-y-1.5"><Label for="menu-path">路由地址</Label><Input id="menu-path" v-model="form.path" required placeholder="/system/users" /></div>
            <div class="space-y-1.5"><Label for="menu-required-permission">访问权限键</Label><select id="menu-required-permission" v-model="form.requiredPermissionKey" class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="">不限制菜单显示</option><option v-for="item in permissionOptions" :key="item.permission_key" :value="item.permission_key">{{ item.permission_key }} · {{ item.description }}</option></select></div>
          </template>
          <div v-else class="space-y-1.5"><Label for="menu-group-path">目录路径</Label><Input id="menu-group-path" v-model="form.path" placeholder="/system" /></div>
          <div class="space-y-1.5"><Label for="menu-order">排序</Label><Input id="menu-order" v-model.number="form.sortOrder" type="number" min="0" max="100000" required /></div>
          <div class="flex flex-wrap items-center gap-5 self-end pb-2 text-sm"><label class="flex items-center gap-2"><input v-model="form.isVisible" type="checkbox" />菜单可见</label><label class="flex items-center gap-2"><input v-model="form.isActive" type="checkbox" />菜单启用</label></div>
          <p v-if="actionError" role="alert" class="text-sm text-destructive sm:col-span-2">{{ actionError }}</p>
          <div class="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" @click="editorOpen = false">取消</Button><Button type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存菜单" }}</Button></div>
        </form>
      </section>
    </div>

    <p v-if="!canRead" class="sr-only" role="alert">当前账号没有菜单读取权限。</p>
  </main>
</template>
