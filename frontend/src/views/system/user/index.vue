<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessageBox, type FormInstance, type FormRules } from "element-plus";
import { message } from "@/utils/message";
import {
  createUser,
  deleteUser,
  getDepartmentOptions,
  getPostOptions,
  getRoleOptions,
  getUsers,
  resetUserPassword,
  updateUser,
  updateUserStatus,
  type OptionItem,
  type UserListItem,
  type UserPayload,
  type UserQuery
} from "@/api/system";

defineOptions({
  name: "SystemUser"
});

const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const dialogMode = ref<"create" | "edit">("create");
const formRef = ref<FormInstance>();
const users = ref<UserListItem[]>([]);
const departments = ref<OptionItem[]>([]);
const posts = ref<OptionItem[]>([]);
const roles = ref<OptionItem[]>([]);

const query = reactive<UserQuery>({
  userCode: "",
  username: "",
  nickname: "",
  phone: "",
  deptId: "",
  postId: "",
  status: "",
  page: 1,
  pageSize: 10
});

const pagination = reactive({
  totalItems: 0,
  totalPages: 0
});

const form = reactive<UserPayload & { id?: number }>({
  userCode: "",
  username: "",
  password: "123456",
  nickname: "",
  phone: "",
  email: "",
  deptId: null,
  postId: null,
  status: 1,
  roleIds: []
});

const rules: FormRules = {
  userCode: [{ required: true, message: "请输入用户工号", trigger: "blur" }],
  username: [{ required: true, message: "请输入登录名", trigger: "blur" }],
  password: [{ required: true, message: "请输入初始密码", trigger: "blur" }],
  nickname: [{ required: true, message: "请输入中文姓名", trigger: "blur" }],
  deptId: [{ required: true, message: "请选择部门", trigger: "change" }],
  postId: [{ required: true, message: "请选择岗位", trigger: "change" }],
  roleIds: [{ required: true, message: "请选择角色", trigger: "change" }]
};

function resetForm() {
  Object.assign(form, {
    id: undefined,
    userCode: "",
    username: "",
    password: "123456",
    nickname: "",
    phone: "",
    email: "",
    deptId: null,
    postId: null,
    status: 1,
    roleIds: []
  });
}

function resolveError(error: any, fallback: string) {
  return error?.response?.data?.error?.message ?? error?.error?.message ?? fallback;
}

function asUser(row: unknown): UserListItem {
  return row as UserListItem;
}

async function loadOptions() {
  const [deptRes, postRes, roleRes] = await Promise.all([
    getDepartmentOptions(),
    getPostOptions(),
    getRoleOptions()
  ]);
  departments.value = deptRes.data;
  posts.value = postRes.data;
  roles.value = roleRes.data;
}

async function loadUsers() {
  loading.value = true;
  try {
    const res = await getUsers(query);
    users.value = res.data.items;
    pagination.totalItems = res.data.pagination.totalItems;
    pagination.totalPages = res.data.pagination.totalPages;
  } catch (error) {
    message(resolveError(error, "用户列表加载失败"), { type: "error" });
  } finally {
    loading.value = false;
  }
}

function handleSearch() {
  query.page = 1;
  loadUsers();
}

function openCreate() {
  dialogMode.value = "create";
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row: UserListItem) {
  dialogMode.value = "edit";
  Object.assign(form, {
    id: row.id,
    userCode: row.userCode,
    username: row.username,
    password: "",
    nickname: row.nickname,
    phone: row.phone ?? "",
    email: row.email ?? "",
    deptId: row.deptId,
    postId: row.postId,
    status: row.status,
    roleIds: row.roles.map(role => role.id)
  });
  dialogVisible.value = true;
}

async function submitForm() {
  if (!formRef.value) return;
  await formRef.value.validate(async valid => {
    if (!valid) return;
    saving.value = true;
    try {
      const payload: UserPayload = {
        userCode: form.userCode,
        username: form.username,
        nickname: form.nickname,
        phone: form.phone,
        email: form.email,
        deptId: form.deptId,
        postId: form.postId,
        status: form.status,
        roleIds: form.roleIds
      };
      if (dialogMode.value === "create") {
        payload.password = form.password;
        await createUser(payload);
      } else if (form.id) {
        await updateUser(form.id, payload);
      }
      message("保存成功", { type: "success" });
      dialogVisible.value = false;
      loadUsers();
    } catch (error) {
      message(resolveError(error, "保存失败"), { type: "error" });
    } finally {
      saving.value = false;
    }
  });
}

async function handleStatusChange(row: UserListItem) {
  const nextStatus = row.status === 1 ? 0 : 1;
  try {
    await updateUserStatus(row.id, nextStatus);
    message(nextStatus === 1 ? "已启用" : "已停用", { type: "success" });
    loadUsers();
  } catch (error) {
    message(resolveError(error, "状态更新失败"), { type: "error" });
  }
}

async function handleResetPassword(row: UserListItem) {
  try {
    const { value } = await ElMessageBox.prompt(
      `请输入 ${row.nickname} 的新密码`,
      "重置密码",
      {
        inputValue: "123456",
        inputPattern: /^.{6,}$/,
        inputErrorMessage: "密码至少 6 位",
        confirmButtonText: "确认",
        cancelButtonText: "取消"
      }
    );
    await resetUserPassword(row.id, value);
    message("密码已重置", { type: "success" });
  } catch (error: any) {
    if (error === "cancel" || error === "close") return;
    message(resolveError(error, "密码重置失败"), { type: "error" });
  }
}

async function handleDelete(row: UserListItem) {
  try {
    await ElMessageBox.confirm(`确认删除用户 ${row.nickname}？`, "删除确认", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消"
    });
    await deleteUser(row.id);
    message("删除成功", { type: "success" });
    loadUsers();
  } catch (error: any) {
    if (error === "cancel" || error === "close") return;
    message(resolveError(error, "删除失败"), { type: "error" });
  }
}

onMounted(async () => {
  await loadOptions();
  await loadUsers();
});
</script>

<template>
  <div class="system-user-page">
    <el-card shadow="never" class="search-panel">
      <el-form :model="query" inline label-width="72px">
        <el-form-item label="工号">
          <el-input v-model="query.userCode" clearable placeholder="用户工号" />
        </el-form-item>
        <el-form-item label="登录名">
          <el-input v-model="query.username" clearable placeholder="登录名" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="query.nickname" clearable placeholder="中文姓名" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="query.phone" clearable placeholder="手机号" />
        </el-form-item>
        <el-form-item label="部门">
          <el-select v-model="query.deptId" clearable placeholder="全部部门">
            <el-option
              v-for="item in departments"
              :key="item.id"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="岗位">
          <el-select v-model="query.postId" clearable placeholder="全部岗位">
            <el-option
              v-for="item in posts"
              :key="item.id"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部状态">
            <el-option label="启用" :value="1" />
            <el-option label="停用" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="handleSearch">查询</el-button>
          <el-button @click="openCreate">新增用户</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" class="table-panel">
      <el-table v-loading="loading" :data="users" row-key="id">
        <el-table-column prop="userCode" label="工号" min-width="100" />
        <el-table-column prop="username" label="登录名" min-width="120" />
        <el-table-column prop="nickname" label="姓名" min-width="120" />
        <el-table-column prop="phone" label="手机号" min-width="130" />
        <el-table-column prop="deptName" label="部门" min-width="120" />
        <el-table-column prop="postName" label="岗位" min-width="120" />
        <el-table-column label="角色" min-width="180">
          <template #default="{ row }">
            <el-space wrap>
              <el-tag v-for="role in row.roles" :key="role.id" size="small">
                {{ role.roleName }}
              </el-tag>
            </el-space>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'">
              {{ row.status === 1 ? "启用" : "停用" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" min-width="170" />
        <el-table-column label="操作" fixed="right" width="280">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(asUser(row))">
              编辑
            </el-button>
            <el-button link type="primary" @click="handleStatusChange(asUser(row))">
              {{ row.status === 1 ? "停用" : "启用" }}
            </el-button>
            <el-button link type="primary" @click="handleResetPassword(asUser(row))">
              重置密码
            </el-button>
            <el-button link type="danger" @click="handleDelete(asUser(row))">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-row">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          :total="pagination.totalItems"
          @size-change="loadUsers"
          @current-change="loadUsers"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增用户' : '编辑用户'"
      width="680px"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="92px"
      >
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="工号" prop="userCode">
              <el-input v-model="form.userCode" placeholder="用户工号" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="登录名" prop="username">
              <el-input v-model="form.username" placeholder="登录名" />
            </el-form-item>
          </el-col>
          <el-col v-if="dialogMode === 'create'" :span="12">
            <el-form-item label="初始密码" prop="password">
              <el-input v-model="form.password" show-password />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="中文姓名" prop="nickname">
              <el-input v-model="form.nickname" placeholder="中文姓名" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="手机号">
              <el-input v-model="form.phone" placeholder="手机号" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="邮箱">
              <el-input v-model="form.email" placeholder="邮箱" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="部门" prop="deptId">
              <el-select v-model="form.deptId" class="w-full!" placeholder="选择部门">
                <el-option
                  v-for="item in departments"
                  :key="item.id"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="岗位" prop="postId">
              <el-select v-model="form.postId" class="w-full!" placeholder="选择岗位">
                <el-option
                  v-for="item in posts"
                  :key="item.id"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="状态" prop="status">
              <el-radio-group v-model="form.status">
                <el-radio-button :value="1">启用</el-radio-button>
                <el-radio-button :value="0">停用</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="24">
            <el-form-item label="角色" prop="roleIds">
              <el-select
                v-model="form.roleIds"
                multiple
                class="w-full!"
                placeholder="选择角色"
              >
                <el-option
                  v-for="item in roles"
                  :key="item.id"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.system-user-page {
  padding: 16px;
}

.search-panel,
.table-panel {
  border-radius: 6px;
}

.table-panel {
  margin-top: 12px;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
}
</style>
