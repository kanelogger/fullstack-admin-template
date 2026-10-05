import { computed, onMounted, reactive, ref } from "vue";
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


export function useUsersPage() {
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

  return {
    userStore, permissions, canCreate, canUpdate, canDelete, canResetPassword,
    canAssignRoles, canReadDepartments, canReadPosts, loading, saving, editorOpen,
    editorMode, users, roles, departments, posts, departmentOptionsError,
    postOptionsError, page, pageSize, total, listError, query, form, clearForm,
    loadUsers, departmentLabel, postLabel, hasDepartmentOption, hasPostOption,
    search, resetSearch, openCreate, openEdit, handleRoleCheckbox, saveUser,
    toggleStatus, resetPassword, removeUser, formatDate, pageCount
  };
}
