<script setup lang="ts">
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useUsersPage } from "@/features/users/use-users-page";

defineOptions({ name: "SystemUser" });

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
  userStore,
  canCreate,
  canUpdate,
  canDelete,
  canResetPassword,
  canAssignRoles,
  canReadDepartments,
  canReadPosts,
  loading,
  saving,
  editorOpen,
  editorMode,
  users,
  roles,
  departments,
  posts,
  departmentOptionsError,
  postOptionsError,
  page,
  pageSize,
  total,
  listError,
  query,
  form,
  clearForm,
  loadUsers,
  departmentLabel,
  postLabel,
  hasDepartmentOption,
  hasPostOption,
  search,
  resetSearch,
  openCreate,
  openEdit,
  handleRoleCheckbox,
  saveUser,
  toggleStatus,
  resetPassword,
  removeUser,
  formatDate,
  pageCount
} = useUsersPage();
/* eslint-enable @typescript-eslint/no-unused-vars */

const { restore: restoreEditorFocus } = useDialogReturnFocus(editorOpen);
</script>

<template>
  <main class="space-y-6 p-4 sm:p-6">
    <Dialog v-model:open="editorOpen">
      <header class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">用户管理</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            管理登录账号、状态与角色。初始凭据通过密码重置邮件设置。
          </p>
        </div>
        <DialogTrigger v-if="canCreate && canAssignRoles" as-child>
          <Button @click="openCreate">新增用户</Button>
        </DialogTrigger>
      </header>

      <Card>
        <CardHeader class="pb-3">
          <CardTitle class="text-base">筛选用户</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <form @submit.prevent="search">
            <FieldGroup class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Field class="gap-2">
                <FieldLabel for="filter-user-code">工号</FieldLabel>
                <Input id="filter-user-code" v-model="query.userCode" placeholder="搜索工号" />
              </Field>
              <Field class="gap-2">
                <FieldLabel for="filter-login-name">登录名</FieldLabel>
                <Input id="filter-login-name" v-model="query.loginName" placeholder="搜索登录名" />
              </Field>
              <Field class="gap-2">
                <FieldLabel for="filter-display-name">姓名</FieldLabel>
                <Input
                  id="filter-display-name"
                  v-model="query.displayName"
                  placeholder="搜索姓名"
                />
              </Field>
              <Field class="gap-2">
                <FieldLabel for="filter-phone">手机号</FieldLabel>
                <Input id="filter-phone" v-model="query.phone" placeholder="搜索手机号" />
              </Field>
              <Field v-if="canReadDepartments" class="gap-2">
                <FieldLabel for="filter-department">部门</FieldLabel>
                <NativeSelect
                  wrapper-class="w-full"
                  id="filter-department"
                  v-model="query.departmentId"
                  class="h-10 w-full"
                >
                  <NativeSelectOption value="">全部部门</NativeSelectOption>
                  <NativeSelectOption
                    v-for="department in departments"
                    :key="department.id"
                    :value="department.id"
                  >
                    {{ department.deptName }}{{ department.status === 0 ? "（停用）" : "" }}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field v-if="canReadPosts" class="gap-2">
                <FieldLabel for="filter-post">岗位</FieldLabel>
                <NativeSelect
                  wrapper-class="w-full"
                  id="filter-post"
                  v-model="query.postId"
                  class="h-10 w-full"
                >
                  <NativeSelectOption value="">全部岗位</NativeSelectOption>
                  <NativeSelectOption v-for="post in posts" :key="post.id" :value="post.id">
                    {{ post.postName }}{{ post.status === 0 ? "（停用）" : "" }}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              <Field class="gap-2">
                <FieldLabel for="filter-status">状态</FieldLabel>
                <NativeSelect
                  wrapper-class="w-full"
                  id="filter-status"
                  v-model="query.status"
                  class="h-10 w-full"
                >
                  <NativeSelectOption value="">全部状态</NativeSelectOption>
                  <NativeSelectOption value="active">启用</NativeSelectOption>
                  <NativeSelectOption value="inactive">停用</NativeSelectOption>
                </NativeSelect>
              </Field>
              <div class="flex items-end gap-2">
                <Button type="submit" class="flex-1">查询</Button>
                <Button type="button" variant="outline" @click="resetSearch">重置</Button>
              </div>
            </FieldGroup>
          </form>
          <Alert
            variant="destructive"
            v-if="
              (canReadDepartments && departmentOptionsError) || (canReadPosts && postOptionsError)
            "
            ><AlertDescription>
              {{ [departmentOptionsError, postOptionsError].filter(Boolean).join("；") }}
              用户列表筛选仍可按已保存的关联 ID 使用。
            </AlertDescription></Alert
          >
        </CardContent>
      </Card>

      <Card>
        <Alert variant="destructive" v-if="listError" class="m-6"
          ><AlertDescription>
            <p>{{ listError }}</p>
            <Button class="mt-3" size="sm" variant="outline" @click="loadUsers">重试</Button>
          </AlertDescription></Alert
        >
        <div v-else class="overflow-x-auto">
          <Table class="w-full min-w-[1050px] text-left">
            <TableHeader>
              <TableRow>
                <TableHead>工号 / 登录名</TableHead>
                <TableHead>姓名和联系方式</TableHead>
                <TableHead>{{
                  canReadDepartments || canReadPosts ? "部门 / 岗位" : "部门 / 岗位 ID"
                }}</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead class="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading">
                <TableCell colspan="7" class="px-4 py-12 text-center text-muted-foreground"
                  ><span role="status">正在加载用户…</span></TableCell
                >
              </TableRow>
              <TableRow v-else-if="users.length === 0">
                <TableCell colspan="7" class="px-4 py-12 text-center text-muted-foreground"
                  ><span role="status">没有匹配的用户</span></TableCell
                >
              </TableRow>
              <TableRow v-for="user in users" :key="user.id">
                <TableCell>
                  <div class="font-medium">{{ user.userCode || "—" }}</div>
                  <div class="text-xs text-muted-foreground">{{ user.loginName }}</div>
                </TableCell>
                <TableCell>
                  <div>{{ user.displayName }}</div>
                  <div class="text-xs text-muted-foreground">
                    {{ user.email }}<span v-if="user.phone"> · {{ user.phone }}</span>
                  </div>
                </TableCell>
                <TableCell
                  >{{ departmentLabel(user.departmentId) }} /
                  {{ postLabel(user.postId) }}</TableCell
                >
                <TableCell>
                  <div class="flex max-w-64 flex-wrap gap-1.5">
                    <Badge v-for="role in user.roles" :key="role.id" variant="secondary">{{
                      role.name
                    }}</Badge>
                    <span v-if="user.roles.length === 0" class="text-muted-foreground">未分配</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    class="whitespace-nowrap"
                    :variant="user.isActive ? 'default' : 'outline'"
                    >{{ user.isActive ? "启用" : "停用" }}</Badge
                  >
                </TableCell>
                <TableCell>{{ formatDate(user.createdAt) }}</TableCell>
                <TableCell>
                  <div class="flex justify-end gap-1">
                    <Button v-if="canUpdate" size="sm" variant="ghost" @click="openEdit(user)"
                      >编辑</Button
                    >
                    <Button
                      v-if="canUpdate"
                      size="sm"
                      variant="ghost"
                      @click="toggleStatus(user)"
                      >{{ user.isActive ? "停用" : "启用" }}</Button
                    >
                    <Button
                      v-if="canResetPassword"
                      size="sm"
                      variant="ghost"
                      @click="resetPassword(user)"
                      >重置密码</Button
                    >
                    <Button
                      v-if="canDelete"
                      size="sm"
                      variant="ghost"
                      class="text-destructive hover:text-destructive"
                      @click="removeUser(user)"
                      >删除</Button
                    >
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <CardContent class="flex flex-wrap items-center justify-between gap-3 border-t py-4">
          <span class="text-sm text-muted-foreground">共 {{ total }} 个用户</span>
          <div class="flex items-center gap-2">
            <NativeSelect
              v-model.number="pageSize"
              aria-label="每页条数"
              class="h-9"
              @update:model-value="
                page = 1;
                loadUsers();
              "
            >
              <NativeSelectOption :value="10">每页 10 条</NativeSelectOption>
              <NativeSelectOption :value="20">每页 20 条</NativeSelectOption>
              <NativeSelectOption :value="50">每页 50 条</NativeSelectOption>
            </NativeSelect>
            <Button
              size="sm"
              variant="outline"
              :disabled="loading || page <= 1"
              @click="
                page -= 1;
                loadUsers();
              "
              >上一页</Button
            >
            <span class="min-w-20 text-center text-sm">{{ page }} / {{ pageCount }}</span>
            <Button
              size="sm"
              variant="outline"
              :disabled="loading || page >= pageCount"
              @click="
                page += 1;
                loadUsers();
              "
              >下一页</Button
            >
          </div>
        </CardContent>
      </Card>

      <DialogContent class="w-full sm:max-w-2xl" @close-auto-focus="restoreEditorFocus">
        <DialogHeader class="border-b px-6 py-5">
          <DialogTitle>{{ editorMode === "create" ? "新增用户" : "编辑用户" }}</DialogTitle>
          <DialogDescription>邮箱用于接收密码重置邮件，不作为登录名。</DialogDescription>
        </DialogHeader>
        <form @submit.prevent="saveUser">
          <FieldGroup class="gap-5 p-6">
            <div class="grid gap-4 sm:grid-cols-2">
              <Field class="gap-2">
                <FieldLabel for="user-code">工号</FieldLabel>
                <Input id="user-code" v-model="form.userCode" required maxlength="64" />
              </Field>
              <Field class="gap-2">
                <FieldLabel for="user-login-name">登录名</FieldLabel>
                <Input
                  id="user-login-name"
                  v-model="form.loginName"
                  required
                  maxlength="64"
                  autocomplete="off"
                />
              </Field>
              <Field class="gap-2">
                <FieldLabel for="user-display-name">姓名</FieldLabel>
                <Input id="user-display-name" v-model="form.displayName" required maxlength="128" />
              </Field>
              <Field class="gap-2">
                <FieldLabel for="user-email">邮箱</FieldLabel>
                <Input
                  id="user-email"
                  v-model="form.email"
                  type="email"
                  required
                  maxlength="320"
                  :readonly="editorMode === 'edit'"
                />
                <p v-if="editorMode === 'edit'" class="text-xs text-muted-foreground">
                  邮箱由认证账户管理，当前切片暂不支持更换。
                </p>
              </Field>
              <Field class="gap-2">
                <FieldLabel for="user-phone">手机号</FieldLabel>
                <Input id="user-phone" v-model="form.phone" maxlength="32" />
              </Field>
              <Field v-if="canReadDepartments" class="gap-2">
                <FieldLabel for="user-department-id">部门</FieldLabel>
                <NativeSelect
                  wrapper-class="w-full"
                  id="user-department-id"
                  v-model="form.departmentId"
                  :disabled="Boolean(departmentOptionsError)"
                  class="h-10 w-full"
                >
                  <NativeSelectOption value="">未分配</NativeSelectOption>
                  <NativeSelectOption
                    v-if="form.departmentId && !hasDepartmentOption(form.departmentId)"
                    :value="form.departmentId"
                  >
                    部门 ID {{ form.departmentId }}（已删除或不可读取）
                  </NativeSelectOption>
                  <NativeSelectOption
                    v-for="department in departments"
                    :key="department.id"
                    :value="department.id"
                    :disabled="department.status === 0 && form.departmentId !== department.id"
                  >
                    {{ department.deptName }}{{ department.status === 0 ? "（停用）" : "" }}
                  </NativeSelectOption>
                </NativeSelect>
                <Alert variant="destructive" v-if="departmentOptionsError"
                  ><AlertDescription
                    >{{ departmentOptionsError }}；保存时保留当前关联。</AlertDescription
                  ></Alert
                >
              </Field>
              <Field v-if="canReadPosts" class="gap-2">
                <FieldLabel for="user-post-id">岗位</FieldLabel>
                <NativeSelect
                  wrapper-class="w-full"
                  id="user-post-id"
                  v-model="form.postId"
                  :disabled="Boolean(postOptionsError)"
                  class="h-10 w-full"
                >
                  <NativeSelectOption value="">未分配</NativeSelectOption>
                  <NativeSelectOption
                    v-if="form.postId && !hasPostOption(form.postId)"
                    :value="form.postId"
                  >
                    岗位 ID {{ form.postId }}（已删除或不可读取）
                  </NativeSelectOption>
                  <NativeSelectOption
                    v-for="post in posts"
                    :key="post.id"
                    :value="post.id"
                    :disabled="post.status === 0 && form.postId !== post.id"
                  >
                    {{ post.postName }}{{ post.status === 0 ? "（停用）" : "" }}
                  </NativeSelectOption>
                </NativeSelect>
                <Alert variant="destructive" v-if="postOptionsError"
                  ><AlertDescription
                    >{{ postOptionsError }}；保存时保留当前关联。</AlertDescription
                  ></Alert
                >
              </Field>
              <div
                v-if="!canReadDepartments && !canReadPosts && editorMode === 'edit'"
                class="sm:col-span-2 rounded-md border border-border p-3 text-sm text-muted-foreground"
              >
                你没有读取组织目录的权限；保存用户资料时会保留现有部门和岗位关联。
              </div>
            </div>
            <fieldset v-if="canAssignRoles" class="space-y-2">
              <legend class="text-sm font-medium">角色</legend>
              <div class="grid gap-2 rounded-md border border-input p-3 sm:grid-cols-2">
                <label
                  v-for="role in roles"
                  :key="role.id"
                  class="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <Checkbox
                    :model-value="form.roleIds.includes(role.id)"
                    @update:model-value="handleRoleCheckbox(role.id, $event)"
                  />
                  <span>{{ role.name }}</span>
                  <span class="text-xs text-muted-foreground">{{ role.code }}</span>
                </label>
                <p v-if="roles.length === 0" class="text-sm text-muted-foreground">
                  没有可分配的启用角色
                </p>
              </div>
            </fieldset>
            <p v-else-if="editorMode === 'edit'" class="text-sm text-muted-foreground">
              你可以编辑用户资料，但没有角色分配权限。
            </p>
            <DialogFooter class="border-t pt-4">
              <DialogClose as-child
                ><Button type="button" variant="outline" :disabled="saving"
                  >取消</Button
                ></DialogClose
              >
              <Button type="submit" :disabled="saving">{{ saving ? "正在保存…" : "保存" }}</Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  </main>
</template>
