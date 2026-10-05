<script setup lang="ts">
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUsersPage } from "@/features/users/use-users-page";

defineOptions({ name: "SystemUser" });

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
  userStore, canCreate, canUpdate, canDelete, canResetPassword, canAssignRoles,
  canReadDepartments, canReadPosts, loading, saving, editorOpen, editorMode,
  users, roles, departments, posts, departmentOptionsError, postOptionsError,
  page, pageSize, total, listError, query, form, clearForm, loadUsers,
  departmentLabel, postLabel, hasDepartmentOption, hasPostOption, search,
  resetSearch, openCreate, openEdit, handleRoleCheckbox, saveUser, toggleStatus,
  resetPassword, removeUser, formatDate, pageCount
} = useUsersPage();
/* eslint-enable @typescript-eslint/no-unused-vars */
</script>

<template>
  <main class="space-y-6 p-4 sm:p-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">用户管理</h1>
        <p class="mt-1 text-sm text-muted-foreground">管理登录账号、状态与角色。初始凭据通过密码重置邮件设置。</p>
      </div>
      <Button v-if="canCreate && canAssignRoles" @click="openCreate">新增用户</Button>
    </header>

    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">筛选用户</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <form class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" @submit.prevent="search">
          <div class="space-y-1.5">
            <Label for="filter-user-code">工号</Label>
            <Input id="filter-user-code" v-model="query.userCode" placeholder="搜索工号" />
          </div>
          <div class="space-y-1.5">
            <Label for="filter-login-name">登录名</Label>
            <Input id="filter-login-name" v-model="query.loginName" placeholder="搜索登录名" />
          </div>
          <div class="space-y-1.5">
            <Label for="filter-display-name">姓名</Label>
            <Input id="filter-display-name" v-model="query.displayName" placeholder="搜索姓名" />
          </div>
          <div class="space-y-1.5">
            <Label for="filter-phone">手机号</Label>
            <Input id="filter-phone" v-model="query.phone" placeholder="搜索手机号" />
          </div>
          <div v-if="canReadDepartments" class="space-y-1.5">
            <Label for="filter-department">部门</Label>
            <select id="filter-department" v-model="query.departmentId" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">全部部门</option>
              <option v-for="department in departments" :key="department.id" :value="department.id">
                {{ department.deptName }}{{ department.status === 0 ? "（停用）" : "" }}
              </option>
            </select>
          </div>
          <div v-if="canReadPosts" class="space-y-1.5">
            <Label for="filter-post">岗位</Label>
            <select id="filter-post" v-model="query.postId" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">全部岗位</option>
              <option v-for="post in posts" :key="post.id" :value="post.id">
                {{ post.postName }}{{ post.status === 0 ? "（停用）" : "" }}
              </option>
            </select>
          </div>
          <div class="space-y-1.5">
            <Label for="filter-status">状态</Label>
            <select id="filter-status" v-model="query.status" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
          <div class="flex items-end gap-2">
            <Button type="submit" class="flex-1">查询</Button>
            <Button type="button" variant="outline" @click="resetSearch">重置</Button>
          </div>
        </form>
        <p v-if="(canReadDepartments && departmentOptionsError) || (canReadPosts && postOptionsError)" class="text-xs text-destructive" role="alert">
          {{ [departmentOptionsError, postOptionsError].filter(Boolean).join("；") }} 用户列表筛选仍可按已保存的关联 ID 使用。
        </p>
      </CardContent>
    </Card>

    <Card>
      <div v-if="listError" class="m-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
        <p>{{ listError }}</p>
        <Button class="mt-3" size="sm" variant="outline" @click="loadUsers">重试</Button>
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[1050px] text-left text-sm">
          <thead class="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th class="px-4 py-3 font-medium">工号 / 登录名</th>
              <th class="px-4 py-3 font-medium">姓名和联系方式</th>
              <th class="px-4 py-3 font-medium">{{ canReadDepartments || canReadPosts ? "部门 / 岗位" : "部门 / 岗位 ID" }}</th>
              <th class="px-4 py-3 font-medium">角色</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium">创建时间</th>
              <th class="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="px-4 py-12 text-center text-muted-foreground">正在加载用户…</td>
            </tr>
            <tr v-else-if="users.length === 0">
              <td colspan="7" class="px-4 py-12 text-center text-muted-foreground">没有匹配的用户</td>
            </tr>
            <tr v-for="user in users" :key="user.id" class="border-b last:border-0 hover:bg-muted/20">
              <td class="px-4 py-3">
                <div class="font-medium">{{ user.userCode || "—" }}</div>
                <div class="text-xs text-muted-foreground">{{ user.loginName }}</div>
              </td>
              <td class="px-4 py-3">
                <div>{{ user.displayName }}</div>
                <div class="text-xs text-muted-foreground">{{ user.email }}<span v-if="user.phone"> · {{ user.phone }}</span></div>
              </td>
              <td class="px-4 py-3 text-muted-foreground">{{ departmentLabel(user.departmentId) }} / {{ postLabel(user.postId) }}</td>
              <td class="px-4 py-3">
                <div class="flex max-w-64 flex-wrap gap-1.5">
                  <Badge v-for="role in user.roles" :key="role.id" variant="secondary">{{ role.name }}</Badge>
                  <span v-if="user.roles.length === 0" class="text-muted-foreground">未分配</span>
                </div>
              </td>
              <td class="px-4 py-3">
                <Badge :variant='user.isActive ? "default" : "outline"'>{{ user.isActive ? "启用" : "停用" }}</Badge>
              </td>
              <td class="px-4 py-3 text-muted-foreground">{{ formatDate(user.createdAt) }}</td>
              <td class="px-4 py-3">
                <div class="flex justify-end gap-1">
                  <Button v-if="canUpdate" size="sm" variant="ghost" @click="openEdit(user)">编辑</Button>
                  <Button v-if="canUpdate" size="sm" variant="ghost" @click="toggleStatus(user)">{{ user.isActive ? "停用" : "启用" }}</Button>
                  <Button v-if="canResetPassword" size="sm" variant="ghost" @click="resetPassword(user)">重置密码</Button>
                  <Button v-if="canDelete" size="sm" variant="ghost" class="text-destructive hover:text-destructive" @click="removeUser(user)">删除</Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CardContent class="flex flex-wrap items-center justify-between gap-3 border-t py-4">
        <span class="text-sm text-muted-foreground">共 {{ total }} 个用户</span>
        <div class="flex items-center gap-2">
          <select v-model.number="pageSize" aria-label="每页条数" class="h-9 rounded-md border border-input bg-background px-2 text-sm" @change="page = 1; loadUsers()">
            <option :value="10">每页 10 条</option>
            <option :value="20">每页 20 条</option>
            <option :value="50">每页 50 条</option>
          </select>
          <Button size="sm" variant="outline" :disabled="loading || page <= 1" @click="page -= 1; loadUsers()">上一页</Button>
          <span class="min-w-20 text-center text-sm">{{ page }} / {{ pageCount }}</span>
          <Button size="sm" variant="outline" :disabled="loading || page >= pageCount" @click="page += 1; loadUsers()">下一页</Button>
        </div>
      </CardContent>
    </Card>

    <Teleport to="body">
      <div v-if="editorOpen" class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4" @click.self="editorOpen = false">
        <section role="dialog" aria-modal="true" aria-labelledby="user-editor-title" class="my-8 w-full max-w-2xl rounded-xl border border-border bg-background shadow-xl">
          <header class="border-b px-6 py-5">
            <h2 id="user-editor-title" class="text-lg font-semibold">{{ editorMode === "create" ? "新增用户" : "编辑用户" }}</h2>
            <p class="mt-1 text-sm text-muted-foreground">邮箱用于接收密码重置邮件，不作为登录名。</p>
          </header>
          <form class="space-y-5 p-6" @submit.prevent="saveUser">
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="space-y-1.5">
                <Label for="user-code">工号</Label>
                <Input id="user-code" v-model="form.userCode" required maxlength="64" />
              </div>
              <div class="space-y-1.5">
                <Label for="user-login-name">登录名</Label>
                <Input id="user-login-name" v-model="form.loginName" required maxlength="64" autocomplete="off" />
              </div>
              <div class="space-y-1.5">
                <Label for="user-display-name">姓名</Label>
                <Input id="user-display-name" v-model="form.displayName" required maxlength="128" />
              </div>
              <div class="space-y-1.5">
                <Label for="user-email">邮箱</Label>
                <Input id="user-email" v-model="form.email" type="email" required maxlength="320" :readonly="editorMode === 'edit'" />
                <p v-if="editorMode === 'edit'" class="text-xs text-muted-foreground">邮箱由认证账户管理，当前切片暂不支持更换。</p>
              </div>
              <div class="space-y-1.5">
                <Label for="user-phone">手机号</Label>
                <Input id="user-phone" v-model="form.phone" maxlength="32" />
              </div>
              <div v-if="canReadDepartments" class="space-y-1.5">
                <Label for="user-department-id">部门</Label>
                <select id="user-department-id" v-model="form.departmentId" :disabled="Boolean(departmentOptionsError)" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
                  <option value="">未分配</option>
                  <option v-if="form.departmentId && !hasDepartmentOption(form.departmentId)" :value="form.departmentId">
                    部门 ID {{ form.departmentId }}（已删除或不可读取）
                  </option>
                  <option v-for="department in departments" :key="department.id" :value="department.id" :disabled="department.status === 0 && form.departmentId !== department.id">
                    {{ department.deptName }}{{ department.status === 0 ? "（停用）" : "" }}
                  </option>
                </select>
                <p v-if="departmentOptionsError" class="text-xs text-destructive" role="alert">{{ departmentOptionsError }}；保存时保留当前关联。</p>
              </div>
              <div v-if="canReadPosts" class="space-y-1.5">
                <Label for="user-post-id">岗位</Label>
                <select id="user-post-id" v-model="form.postId" :disabled="Boolean(postOptionsError)" class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
                  <option value="">未分配</option>
                  <option v-if="form.postId && !hasPostOption(form.postId)" :value="form.postId">
                    岗位 ID {{ form.postId }}（已删除或不可读取）
                  </option>
                  <option v-for="post in posts" :key="post.id" :value="post.id" :disabled="post.status === 0 && form.postId !== post.id">
                    {{ post.postName }}{{ post.status === 0 ? "（停用）" : "" }}
                  </option>
                </select>
                <p v-if="postOptionsError" class="text-xs text-destructive" role="alert">{{ postOptionsError }}；保存时保留当前关联。</p>
              </div>
              <div v-if="!canReadDepartments && !canReadPosts && editorMode === 'edit'" class="sm:col-span-2 rounded-md border border-border p-3 text-sm text-muted-foreground">
                你没有读取组织目录的权限；保存用户资料时会保留现有部门和岗位关联。
              </div>
            </div>
            <fieldset v-if="canAssignRoles" class="space-y-2">
              <legend class="text-sm font-medium">角色</legend>
              <div class="grid gap-2 rounded-md border border-input p-3 sm:grid-cols-2">
                <label v-for="role in roles" :key="role.id" class="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" :checked="form.roleIds.includes(role.id)" class="size-4 accent-primary" @change="handleRoleCheckbox(role.id, $event)" />
                  <span>{{ role.name }}</span>
                  <span class="text-xs text-muted-foreground">{{ role.code }}</span>
                </label>
                <p v-if="roles.length === 0" class="text-sm text-muted-foreground">没有可分配的启用角色</p>
              </div>
            </fieldset>
            <p v-else-if="editorMode === 'edit'" class="text-sm text-muted-foreground">你可以编辑用户资料，但没有角色分配权限。</p>
            <footer class="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" :disabled="saving" @click="editorOpen = false">取消</Button>
              <Button type="submit" :disabled="saving">{{ saving ? "正在保存…" : "保存" }}</Button>
            </footer>
          </form>
        </section>
      </div>
    </Teleport>
  </main>
</template>
