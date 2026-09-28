<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { type FormInstance, type FormRules } from "element-plus";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import {
  getProfile,
  updateProfile,
  type ProfilePayload,
  type UserProfile
} from "@/api/system";

defineOptions({ name: "ProfileInfo" });

const loading = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();
const profile = ref<UserProfile | null>(null);
const userStore = useUserStoreHook();

const form = reactive<ProfilePayload>({
  nickname: "",
  phone: "",
  email: "",
  avatar: ""
});

const rules: FormRules = {
  nickname: [{ required: true, message: "请输入中文姓名", trigger: "blur" }],
  email: [{ type: "email", message: "邮箱格式不正确", trigger: "blur" }]
};

function resolveError(error: any, fallback: string) {
  return error?.response?.data?.error?.message ?? error?.error?.message ?? fallback;
}

function fillForm(data: UserProfile) {
  profile.value = data;
  Object.assign(form, {
    nickname: data.nickname,
    phone: data.phone ?? "",
    email: data.email ?? "",
    avatar: data.avatar ?? ""
  });
}

async function loadProfile() {
  loading.value = true;
  try {
    const res = await getProfile();
    fillForm(res.data);
  } catch (error) {
    message(resolveError(error, "个人信息加载失败"), { type: "error" });
  } finally {
    loading.value = false;
  }
}

async function submitForm() {
  if (!formRef.value) return;
  await formRef.value.validate(async valid => {
    if (!valid) return;
    saving.value = true;
    try {
      const res = await updateProfile({
        nickname: form.nickname,
        phone: form.phone,
        email: form.email,
        avatar: form.avatar
      });
      fillForm(res.data);
      userStore.SET_NICKNAME(res.data.nickname);
      userStore.SET_AVATAR(res.data.avatar ?? "");
      message("保存成功", { type: "success" });
    } catch (error) {
      message(resolveError(error, "保存失败"), { type: "error" });
    } finally {
      saving.value = false;
    }
  });
}

onMounted(loadProfile);
</script>

<template>
  <div class="profile-page">
    <el-card v-loading="loading" shadow="never" class="profile-card">
      <template #header>
        <div class="card-header">
          <span>个人信息</span>
          <el-button type="primary" :loading="saving" @click="submitForm">
            保存
          </el-button>
        </div>
      </template>

      <div class="profile-layout">
        <div class="profile-summary">
          <el-avatar :size="72" :src="form.avatar || undefined">
            {{ form.nickname.slice(0, 1) || "U" }}
          </el-avatar>
          <div class="profile-name">{{ profile?.nickname ?? "-" }}</div>
          <div class="profile-account">{{ profile?.username ?? "-" }}</div>
        </div>

        <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
          <el-form-item label="用户工号">
            <el-input :model-value="profile?.userCode ?? ''" disabled />
          </el-form-item>
          <el-form-item label="登录名">
            <el-input :model-value="profile?.username ?? ''" disabled />
          </el-form-item>
          <el-form-item label="中文姓名" prop="nickname">
            <el-input v-model="form.nickname" />
          </el-form-item>
          <el-form-item label="手机号">
            <el-input v-model="form.phone" />
          </el-form-item>
          <el-form-item label="邮箱" prop="email">
            <el-input v-model="form.email" />
          </el-form-item>
          <el-form-item label="头像地址">
            <el-input v-model="form.avatar" />
          </el-form-item>
          <el-form-item label="所属部门">
            <el-input :model-value="profile?.deptName ?? ''" disabled />
          </el-form-item>
          <el-form-item label="岗位">
            <el-input :model-value="profile?.postName ?? ''" disabled />
          </el-form-item>
          <el-form-item label="角色">
            <el-tag
              v-for="role in profile?.roles ?? []"
              :key="role.id"
              class="role-tag"
            >
              {{ role.roleName }}
            </el-tag>
          </el-form-item>
        </el-form>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.profile-page {
  padding: 16px;
}

.profile-card {
  max-width: 920px;
  border-radius: 6px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.profile-layout {
  display: grid;
  grid-template-columns: 220px minmax(420px, 1fr);
  gap: 24px;
}

.profile-summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 12px;
}

.profile-name {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 600;
}

.profile-account {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
}

.role-tag {
  margin-right: 8px;
}
</style>
