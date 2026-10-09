<script setup lang="ts">
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRolesPage } from "@/features/roles/use-roles-page";

defineOptions({ name: "SystemRole" });

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
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
} = useRolesPage();
/* eslint-enable @typescript-eslint/no-unused-vars */

const { restore: restoreEditorFocus } = useDialogReturnFocus(editorOpen);
const { restore: restorePermissionFocus } = useDialogReturnFocus(permissionEditorOpen);
const { restore: restoreMemberFocus } = useDialogReturnFocus(memberDialogOpen);
</script>

<template>
  <main class="space-y-4 p-4" data-testid="role-management">
    <Card>
      <CardHeader class="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle>角色管理</CardTitle>
        <Button v-if="canCreate" data-testid="create-role" @click="openCreate">新增角色</Button>
      </CardHeader>
      <CardContent class="space-y-4">
        <form @submit.prevent="updateSearch">
          <FieldGroup class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_180px_auto]">
            <Field class="gap-2">
              <FieldLabel for="role-name-filter">角色名称</FieldLabel>
              <Input
                id="role-name-filter"
                v-model="searchName"
                placeholder="按名称筛选"
                @input="updateSearch"
              />
            </Field>
            <Field class="gap-2">
              <FieldLabel for="role-code-filter">角色编码</FieldLabel>
              <Input
                id="role-code-filter"
                v-model="searchCode"
                placeholder="按编码筛选"
                @input="updateSearch"
              />
            </Field>
            <Field class="gap-2">
              <FieldLabel for="role-status-filter">状态</FieldLabel>
              <NativeSelect
                wrapper-class="w-full"
                id="role-status-filter"
                v-model="statusFilter"
                class="h-9 w-full"
                @update:model-value="updateSearch"
              >
                <NativeSelectOption value="all">全部</NativeSelectOption>
                <NativeSelectOption value="active">启用</NativeSelectOption>
                <NativeSelectOption value="inactive">停用</NativeSelectOption>
              </NativeSelect>
            </Field>
            <div class="flex items-end">
              <Button type="submit" variant="outline">筛选</Button>
            </div>
          </FieldGroup>
        </form>

        <Alert variant="destructive" v-if="actionError"
          ><AlertDescription>{{ actionError }}</AlertDescription></Alert
        >
        <Alert variant="destructive" v-if="loadError"
          ><AlertDescription>{{ loadError }}</AlertDescription></Alert
        >
        <div v-if="loading" role="status" class="py-8 text-center text-sm text-muted-foreground">
          正在加载角色…
        </div>
        <div v-else-if="loadError" class="py-5 text-center">
          <Button variant="outline" @click="loadRoles">重试</Button>
        </div>
        <div v-else-if="!pageRoles.length" class="py-8 text-center text-sm text-muted-foreground">
          {{ total ? "没有符合筛选条件的角色" : "暂无角色" }}
        </div>
        <div v-else class="overflow-x-auto rounded-md border">
          <Table class="w-full min-w-[820px] text-left">
            <TableHeader>
              <TableRow>
                <TableHead>角色名称</TableHead>
                <TableHead>角色编码</TableHead>
                <TableHead>授权权限</TableHead>
                <TableHead>用户数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-for="role in pageRoles" :key="role.id">
                <TableCell>
                  <div class="font-medium">{{ role.name }}</div>
                  <div class="text-xs text-muted-foreground">{{ role.description || "—" }}</div>
                </TableCell>
                <TableCell class="font-mono">{{ role.code }}</TableCell>
                <TableCell>{{ role.permissionKeys.length }}</TableCell>
                <TableCell>{{ role.userCount }}</TableCell>
                <TableCell>
                  <Badge :variant="role.isActive ? 'default' : 'secondary'">{{
                    role.isActive ? "启用" : "停用"
                  }}</Badge>
                  <Badge v-if="role.isSystem" variant="outline" class="ml-1">系统角色</Badge>
                </TableCell>
                <TableCell>
                  <div class="flex flex-wrap gap-2">
                    <Button v-if="canUpdate" size="sm" variant="outline" @click="openEdit(role)"
                      >编辑</Button
                    >
                    <Button v-if="canRead" size="sm" variant="outline" @click="openMembers(role)"
                      >成员</Button
                    >
                    <Button
                      v-if="canAssign && role.code !== 'SUPER_ADMIN'"
                      size="sm"
                      variant="outline"
                      @click="openPermissionEditor(role)"
                      >菜单与权限</Button
                    >
                    <span
                      v-else-if="canAssign && role.code === 'SUPER_ADMIN'"
                      class="self-center text-xs text-muted-foreground"
                      >系统权限</span
                    >
                    <Button
                      v-if="canUpdate && !role.isSystem"
                      size="sm"
                      variant="ghost"
                      @click="toggleActive(role)"
                      >{{ role.isActive ? "停用" : "启用" }}</Button
                    >
                    <Button
                      v-if="canDelete && !role.isSystem"
                      size="sm"
                      variant="ghost"
                      class="text-destructive"
                      @click="removeRole(role)"
                      >删除</Button
                    >
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div v-if="total > pageSize" class="flex items-center justify-end gap-3 text-sm">
          <span class="text-muted-foreground">共 {{ total }} 个角色</span>
          <Button
            size="sm"
            variant="outline"
            :disabled="page <= 1"
            @click="changeRolePage(page - 1)"
            >上一页</Button
          >
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <Button
            size="sm"
            variant="outline"
            :disabled="page >= totalPages"
            @click="changeRolePage(page + 1)"
            >下一页</Button
          >
          <NativeSelect
            v-model.number="pageSize"
            aria-label="每页条数"
            class="h-8"
            @update:model-value="
              page = 1;
              loadRoles();
            "
          >
            <NativeSelectOption :value="10">10 条</NativeSelectOption
            ><NativeSelectOption :value="20">20 条</NativeSelectOption
            ><NativeSelectOption :value="50">50 条</NativeSelectOption>
          </NativeSelect>
        </div>
      </CardContent>
    </Card>

    <Dialog v-model:open="editorOpen"
      ><DialogContent
        class="max-h-[90vh] w-full sm:max-w-xl overflow-y-auto"
        :aria-describedby="undefined"
        @close-auto-focus="restoreEditorFocus"
      >
        <DialogHeader>
          <DialogTitle>{{ editorMode === "create" ? "新增角色" : "编辑角色" }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="saveRoleMetadata">
          <FieldGroup class="mt-4 gap-4">
            <Field class="gap-2">
              <FieldLabel for="role-code">角色编码</FieldLabel>
              <Input
                id="role-code"
                v-model="form.code"
                :disabled="editorMode === 'edit'"
                placeholder="例如 SUPPORT_AGENT"
                autocomplete="off"
              />
              <p class="text-xs text-muted-foreground">使用稳定的大写编码；编码创建后不可修改。</p>
            </Field>
            <Field class="gap-2">
              <FieldLabel for="role-name">角色名称</FieldLabel>
              <Input id="role-name" v-model="form.name" required maxlength="128" />
            </Field>
            <Field class="gap-2">
              <FieldLabel for="role-description">说明</FieldLabel>
              <Textarea
                id="role-description"
                v-model="form.description"
                rows="3"
                maxlength="2000"
                class="w-full"
              />
            </Field>
            <label
              v-if="editorMode === 'edit' && editingRole?.code !== 'SUPER_ADMIN'"
              class="flex items-center gap-2 text-sm"
            >
              <Switch
                :model-value="form.isActive"
                @update:model-value="form.isActive = $event === true"
              />
              角色启用
            </label>
            <p v-else-if="editorMode === 'edit'" class="text-xs text-muted-foreground">
              SUPER_ADMIN 必须保持启用。
            </p>
            <Alert variant="destructive" v-if="actionError"
              ><AlertDescription>{{ actionError }}</AlertDescription></Alert
            >
            <div class="flex justify-end gap-2">
              <DialogClose as-child
                ><Button type="button" variant="outline">取消</Button></DialogClose
              >
              <Button type="submit" :disabled="saving">{{
                saving ? "保存中…" : "保存角色"
              }}</Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent></Dialog
    >

    <Dialog v-model:open="permissionEditorOpen"
      ><DialogContent
        class="max-h-[90vh] w-full sm:max-w-3xl overflow-y-auto"
        @close-auto-focus="restorePermissionFocus"
      >
        <DialogHeader>
          <DialogTitle>角色权限 · {{ editingRole?.name }}</DialogTitle>
          <DialogDescription
            >菜单访问由 requiredPermissionKey
            决定；按钮操作权限单独保留。同权限键对应的页面会联动授权。</DialogDescription
          >
        </DialogHeader>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <fieldset class="space-y-2 rounded-md border p-3 md:col-span-2">
            <legend class="px-1 text-sm font-semibold">菜单访问</legend>
            <label
              v-for="menu in menuRows"
              :key="menu.id"
              class="flex items-start gap-2 py-1 text-sm"
            >
              <Checkbox
                :model-value="menuNodeChecked(menu)"
                :disabled="
                  !menuNodeChecked(menu) &&
                  menu.kind === 'group' &&
                  descendantMenuKeys(menu.id).length === 0
                "
                :aria-label="`菜单 ${menu.title}`"
                @update:model-value="toggleMenuAuthorization(menu, $event === true)"
              />
              <span :style="{ paddingLeft: `${menu.depth * 18}px` }">
                <span>{{ menu.kind === "group" ? "目录" : "页面" }} · {{ menu.title }}</span>
                <span
                  v-if="menu.requiredPermissionKey"
                  class="ml-2 font-mono text-xs text-muted-foreground"
                  >{{ menu.requiredPermissionKey }}</span
                >
                <span
                  v-if="menu.kind === 'route' && !menu.isActive"
                  class="ml-2 text-xs text-muted-foreground"
                  >停用</span
                >
              </span>
            </label>
          </fieldset>
          <fieldset
            v-for="[group, entries] in groupedPermissions"
            :key="group"
            class="space-y-2 rounded-md border p-3"
          >
            <legend class="px-1 text-sm font-semibold">操作权限 · {{ group }}</legend>
            <label
              v-for="permission in entries"
              :key="permission.key"
              class="flex items-start gap-2 text-sm"
            >
              <Checkbox
                :model-value="selectedActionPermissionKeys.includes(permission.key)"
                :aria-label="`${permission.key} ${permission.description}`"
                @update:model-value="toggleActionPermission(permission.key, $event === true)"
              />
              <span
                ><code class="font-mono text-xs">{{ permission.key }}</code
                ><span class="block text-muted-foreground">{{ permission.description }}</span></span
              >
            </label>
          </fieldset>
        </div>
        <Alert variant="destructive" v-if="actionError" class="mt-3"
          ><AlertDescription>{{ actionError }}</AlertDescription></Alert
        >
        <div class="mt-5 flex justify-end gap-2">
          <DialogClose as-child><Button variant="outline">取消</Button></DialogClose>
          <Button :disabled="saving" @click="saveAuthorization">{{
            saving ? "保存中…" : "保存授权"
          }}</Button>
        </div>
      </DialogContent></Dialog
    >

    <Dialog v-model:open="memberDialogOpen"
      ><DialogContent
        class="max-h-[90vh] w-full sm:max-w-3xl overflow-y-auto"
        @close-auto-focus="restoreMemberFocus"
      >
        <DialogHeader>
          <DialogTitle>角色成员 · {{ memberRole?.name }}</DialogTitle>
          <DialogDescription>显示未删除账号；停用账号保留在成员列表中。</DialogDescription>
        </DialogHeader>
        <Alert variant="destructive" v-if="memberError" class="mt-3"
          ><AlertDescription>{{ memberError }}</AlertDescription></Alert
        >
        <p
          v-if="membersLoading"
          role="status"
          class="py-8 text-center text-sm text-muted-foreground"
        >
          正在加载成员…
        </p>
        <p v-else-if="!memberRows.length" class="py-8 text-center text-sm text-muted-foreground">
          该角色暂无成员
        </p>
        <div v-else class="mt-4 overflow-x-auto rounded-md border">
          <Table class="w-full min-w-[520px] text-left">
            <TableHeader
              ><TableRow>
                <TableHead>工号</TableHead><TableHead>登录账号</TableHead
                ><TableHead>显示名称</TableHead><TableHead>状态</TableHead>
              </TableRow></TableHeader
            >
            <TableBody
              ><TableRow v-for="member in memberRows" :key="member.id">
                <TableCell>{{ member.userCode ?? "—" }}</TableCell
                ><TableCell>{{ member.loginName }}</TableCell
                ><TableCell>{{ member.displayName }}</TableCell>
                <TableCell
                  ><Badge :variant="member.isActive ? 'default' : 'secondary'">{{
                    member.isActive ? "启用" : "停用"
                  }}</Badge></TableCell
                >
              </TableRow></TableBody
            >
          </Table>
        </div>
        <div class="mt-4 flex items-center justify-end gap-3 text-sm">
          <span class="text-muted-foreground"
            >共 {{ memberTotal }} 名成员 · 第 {{ memberPage }} /
            {{ Math.max(1, Math.ceil(memberTotal / memberPageSize)) }} 页</span
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="membersLoading || memberPage <= 1"
            @click="
              memberPage--;
              loadMembers();
            "
            >上一页</Button
          >
          <Button
            size="sm"
            variant="outline"
            :disabled="membersLoading || memberPage >= Math.ceil(memberTotal / memberPageSize)"
            @click="
              memberPage++;
              loadMembers();
            "
            >下一页</Button
          >
          <DialogClose as-child><Button variant="outline">关闭</Button></DialogClose>
        </div>
      </DialogContent></Dialog
    >

    <Alert variant="destructive" v-if="!canRead"
      ><AlertDescription>当前账号没有角色读取权限。</AlertDescription></Alert
    >
  </main>
</template>
