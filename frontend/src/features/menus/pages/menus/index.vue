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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useMenusPage } from "@/features/menus/use-menus-page";

defineOptions({ name: "SystemMenu" });

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
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
} = useMenusPage();
/* eslint-enable @typescript-eslint/no-unused-vars */
const { restore: restoreEditorFocus } = useDialogReturnFocus(editorOpen);
const { restore: restoreRoleAssignmentFocus } = useDialogReturnFocus(roleAssignmentOpen);
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
