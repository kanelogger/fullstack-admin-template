<script setup lang="ts">
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRolesPage } from "@/features/roles/use-roles-page";

defineOptions({ name: "SystemRole" });

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
  canRead, canCreate, canUpdate, canDelete, canAssign, loading, saving, roles,
  permissions, menus, total, loadError, actionError, searchName, searchCode,
  statusFilter, page, pageSize, editorOpen, permissionEditorOpen, memberDialogOpen,
  memberRole, memberRows, membersLoading, memberError, memberPage, memberPageSize,
  memberTotal, editorMode, editingRole, selectedMenuPermissionKeys,
  selectedActionPermissionKeys, form, pageRoles, totalPages, menuRows,
  groupedPermissions, loadRoles, openCreate, openEdit, saveRoleMetadata,
  openPermissionEditor, descendantMenuKeys, menuNodeChecked, toggleMenuAuthorization,
  toggleActionPermission, saveAuthorization, loadMembers, openMembers, toggleActive,
  removeRole, updateSearch, changeRolePage
} = useRolesPage();
/* eslint-enable @typescript-eslint/no-unused-vars */
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
