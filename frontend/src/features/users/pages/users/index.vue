<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { message } from "@/utils/message";
import { useSessionStoreHook } from "@/stores/modules/session";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import {
  listDepartmentOptions,
  listPostOptions
} from "@/features/organization/organization.service";
import {
  createManagedUser,
  deleteManagedUser,
  getManagedUserRoles,
  listManagedUsers,
  sendManagedUserPasswordReset,
  setManagedUserActive,
  updateManagedUser
} from "@/features/users/users.service";
import type {
  Department,
  ManagedUser,
  Post,
  UserManagementRoleOption
} from "@template/contracts";

defineOptions({ name: "SystemUser" });

type StatusFilter = "" | "active" | "inactive";
type UserForm = {
  id?: string;
  userCode: string;
  loginName: string;
  displayName: string;
  email: string;
  phone: string;
  departmentId: string;
  postId: string;
  roleIds: string[];
};

const userStore = useSessionStoreHook();
const permissions = computed(() => new Set(usePermissionStoreHook().permissionKeys));
const canCreate = computed(() => permissions.value.has("administration.users.create"));
const canUpdate = computed(() => permissions.value.has("administration.users.update"));
const canDelete = computed(() => permissions.value.has("administration.users.delete"));
const canResetPassword = computed(() => permissions.value.has("administration.users.reset_password"));
const canAssignRoles = computed(() => permissions.value.has("administration.users.assign_roles"));
const canReadDepartments = computed(() => permissions.value.has("organization.departments.read"));
const canReadPosts = computed(() => permissions.value.has("organization.posts.read"));

const loading = ref(false);
const saving = ref(false);
const editorOpen = ref(false);
const editorMode = ref<"create" | "edit">("create");
const users = ref<ManagedUser[]>([]);
const roles = ref<UserManagementRoleOption[]>([]);
const departments = ref<Department[]>([]);
const posts = ref<Post[]>([]);
const departmentOptionsError = ref("");
const postOptionsError = ref("");
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const listError = ref("");
const query = reactive({
  userCode: "",
  loginName: "",
  displayName: "",
  phone: "",
  departmentId: "",
  postId: "",
  status: "" as StatusFilter
});

const form = reactive<UserForm>({
  userCode: "",
  loginName: "",
  displayName: "",
  email: "",
  phone: "",
  departmentId: "",
  postId: "",
  roleIds: []
});

function resolveError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function clearForm() {
  Object.assign(form, {
    id: undefined,
    userCode: "",
    loginName: "",
    displayName: "",
    email: "",
    phone: "",
    departmentId: "",
    postId: "",
    roleIds: []
  });
}

function optionalId(value: string): string | null {
  return value.trim() || null;
}

async function loadUsers() {
  loading.value = true;
  listError.value = "";
  try {
    const result = await listManagedUsers({
      ...query,
      userCode: query.userCode.trim() || undefined,
      loginName: query.loginName.trim() || undefined,
      displayName: query.displayName.trim() || undefined,
      phone: query.phone.trim() || undefined,
      departmentId: query.departmentId.trim() || undefined,
      postId: query.postId.trim() || undefined,
      status: query.status || undefined,
      page: page.value,
      pageSize: pageSize.value
    });
    users.value = result.items;
    total.value = result.total;
  } catch (error) {
    listError.value = resolveError(error, "用户列表加载失败");
    users.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

async function loadRoleOptions() {
  if (!canAssignRoles.value) return;
  try {
    roles.value = await getManagedUserRoles();
  } catch (error) {
    message(resolveError(error, "角色选项加载失败"), { type: "error" });
  }
}

async function loadOrganizationOptions() {
  const tasks: Promise<void>[] = [];
  if (canReadDepartments.value) {
    tasks.push((async () => {
      try {
        departments.value = await listDepartmentOptions();
        departmentOptionsError.value = "";
      } catch (error) {
        departmentOptionsError.value = resolveError(error, "部门选项加载失败");
      }
    })());
  }
  if (canReadPosts.value) {
    tasks.push((async () => {
      try {
        posts.value = await listPostOptions();
        postOptionsError.value = "";
      } catch (error) {
        postOptionsError.value = resolveError(error, "岗位选项加载失败");
      }
    })());
  }
  await Promise.all(tasks);
}

function departmentLabel(id: string | null): string {
  if (!id) return "—";
  const department = departments.value.find(item => item.id === id);
  if (!department) return `部门 ID ${id}`;
  return `${department.deptName}${department.status === 0 ? "（停用）" : ""}`;
}

function postLabel(id: string | null): string {
  if (!id) return "—";
  const post = posts.value.find(item => item.id === id);
  if (!post) return `岗位 ID ${id}`;
  return `${post.postName}${post.status === 0 ? "（停用）" : ""}`;
}

function hasDepartmentOption(id: string): boolean {
  return departments.value.some(item => item.id === id);
}

function hasPostOption(id: string): boolean {
  return posts.value.some(item => item.id === id);
}

async function search() {
  page.value = 1;
  await loadUsers();
}

async function resetSearch() {
  Object.assign(query, {
    userCode: "",
    loginName: "",
    displayName: "",
    phone: "",
    departmentId: "",
    postId: "",
    status: ""
  });
  page.value = 1;
  await loadUsers();
}

async function openCreate() {
  if (!canCreate.value || !canAssignRoles.value) return;
  editorMode.value = "create";
  clearForm();
  await Promise.all([loadRoleOptions(), loadOrganizationOptions()]);
  editorOpen.value = true;
}

async function openEdit(user: ManagedUser) {
  if (!canUpdate.value) return;
  editorMode.value = "edit";
  Object.assign(form, {
    id: user.id,
    userCode: user.userCode ?? "",
    loginName: user.loginName,
    displayName: user.displayName,
    email: user.email,
    phone: user.phone ?? "",
    departmentId: user.departmentId ?? "",
    postId: user.postId ?? "",
    roleIds: user.roles.map(role => role.id)
  });
  await Promise.all([
    canAssignRoles.value ? loadRoleOptions() : Promise.resolve(),
    loadOrganizationOptions()
  ]);
  editorOpen.value = true;
}

function toggleRole(id: string, checked: boolean) {
  if (checked && !form.roleIds.includes(id)) form.roleIds.push(id);
  if (!checked) form.roleIds = form.roleIds.filter(roleId => roleId !== id);
}

function handleRoleCheckbox(id: string, event: Event) {
  toggleRole(id, (event.target as HTMLInputElement).checked);
}

async function saveUser() {
  if (saving.value) return;
  if (!form.userCode.trim() || !form.loginName.trim() || !form.displayName.trim()) {
    message("请填写工号、登录名和姓名", { type: "warning" });
    return;
  }
  if (!form.email.trim()) {
    message("邮箱用于密码重置，请填写邮箱", { type: "warning" });
    return;
  }
  if (canAssignRoles.value && form.roleIds.length === 0) {
    message("请至少分配一个角色", { type: "warning" });
    return;
  }

  saving.value = true;
  try {
    if (editorMode.value === "create") {
      await createManagedUser({
        userCode: form.userCode,
        loginName: form.loginName,
        displayName: form.displayName,
        email: form.email,
        phone: form.phone || null,
        departmentId: optionalId(form.departmentId),
        postId: optionalId(form.postId),
        roleIds: form.roleIds
      });
      message("用户已创建，密码重置邮件已发送", { type: "success" });
    } else if (form.id) {
      const input = {
        id: form.id,
        userCode: form.userCode,
        loginName: form.loginName,
        displayName: form.displayName,
        phone: form.phone || null,
        departmentId: optionalId(form.departmentId),
        postId: optionalId(form.postId),
        ...(canAssignRoles.value ? { roleIds: form.roleIds } : {})
      };
      const updated = await updateManagedUser(input);
      if (updated.id === userStore.userId) {
        await userStore.refreshAuthorization(true);
      }
      message("用户资料已保存", { type: "success" });
    }
    editorOpen.value = false;
    await loadUsers();
  } catch (error) {
    message(resolveError(error, "用户资料保存失败"), { type: "error" });
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(user: ManagedUser) {
  const nextActive = !user.isActive;
  if (!window.confirm(`${nextActive ? "启用" : "停用"}用户 ${user.displayName}？`)) return;
  try {
    const updated = await setManagedUserActive(user.id, nextActive);
    if (updated.id === userStore.userId) {
      await userStore.refreshAuthorization(true);
    }
    message(nextActive ? "用户已启用" : "用户已停用", { type: "success" });
    await loadUsers();
  } catch (error) {
    message(resolveError(error, "用户状态更新失败"), { type: "error" });
  }
}

async function resetPassword(user: ManagedUser) {
  if (!window.confirm(`向 ${user.email} 发送密码重置邮件？`)) return;
  try {
    const result = await sendManagedUserPasswordReset(user.id);
    message(result, { type: "success" });
  } catch (error) {
    message(resolveError(error, "重置邮件发送失败"), { type: "error" });
  }
}

async function removeUser(user: ManagedUser) {
  if (!window.confirm(`删除用户 ${user.displayName}？该用户将立即无法登录。`)) return;
  try {
    await deleteManagedUser(user.id);
    if (user.id === userStore.userId) {
      await userStore.refreshAuthorization(true);
    }
    message("用户已删除", { type: "success" });
    if (users.value.length === 1 && page.value > 1) page.value -= 1;
    await loadUsers();
  } catch (error) {
    message(resolveError(error, "用户删除失败"), { type: "error" });
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

onMounted(async () => {
  await Promise.all([loadRoleOptions(), loadOrganizationOptions(), loadUsers()]);
});
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
