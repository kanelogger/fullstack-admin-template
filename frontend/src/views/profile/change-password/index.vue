<script setup lang="ts">
import { reactive, ref } from "vue";
import { type FormInstance, type FormRules } from "element-plus";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import { changeProfilePassword } from "@/api/system";

defineOptions({ name: "ProfileChangePassword" });

const saving = ref(false);
const formRef = ref<FormInstance>();
const userStore = useUserStoreHook();

const form = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: ""
});

const rules: FormRules = {
  oldPassword: [{ required: true, message: "请输入原密码", trigger: "blur" }],
  newPassword: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 6, message: "新密码至少 6 位", trigger: "blur" }
  ],
  confirmPassword: [
    { required: true, message: "请再次输入新密码", trigger: "blur" },
    {
      validator: (_rule, value, callback) => {
        if (value !== form.newPassword) callback(new Error("两次输入的新密码不一致"));
        else callback();
      },
      trigger: "blur"
    }
  ]
};

function resolveError(error: any, fallback: string) {
  const code = error?.response?.data?.error?.code ?? error?.error?.code;
  if (code === "INVALID_OLD_PASSWORD") return "原密码错误";
  if (code === "PASSWORD_CONFIRM_MISMATCH") return "两次输入的新密码不一致";
  if (code === "PASSWORD_UNCHANGED") return "新密码不能与原密码相同";
  return error?.response?.data?.error?.message ?? error?.error?.message ?? fallback;
}

async function submitForm() {
  if (!formRef.value) return;
  await formRef.value.validate(async valid => {
    if (!valid) return;
    saving.value = true;
    try {
      await changeProfilePassword({
        oldPassword: form.oldPassword,
        newPassword: form.newPassword,
        confirmPassword: form.confirmPassword
      });
      message("密码修改成功，请重新登录", { type: "success" });
      userStore.logOut();
    } catch (error) {
      message(resolveError(error, "密码修改失败"), { type: "error" });
    } finally {
      saving.value = false;
    }
  });
}

function resetForm() {
  formRef.value?.resetFields();
}
</script>

<template>
  <div class="change-password-page">
    <el-card shadow="never" class="password-card">
      <template #header>
        <span>修改密码</span>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="96px">
        <el-form-item label="原密码" prop="oldPassword">
          <el-input v-model="form.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="form.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="submitForm">
            保存
          </el-button>
          <el-button @click="resetForm">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.change-password-page {
  padding: 16px;
}

.password-card {
  max-width: 620px;
  border-radius: 6px;
}
</style>
