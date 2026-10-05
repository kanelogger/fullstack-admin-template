<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  completePasswordReset,
  restorePasswordRecoverySession
} from "@/features/auth/auth.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoaderCircle, ShieldCheck } from "@lucide/vue";

defineOptions({ name: "ResetPassword" });

const router = useRouter();
const newPassword = ref("");
const confirmPassword = ref("");
const loading = ref(false);
const checkingSession = ref(true);
const hasRecoverySession = ref(false);

onMounted(async () => {
  try {
    const recovery = await restorePasswordRecoverySession(window.location.hash);
    hasRecoverySession.value = recovery.available;
    if (recovery.scrubCallback) await router.replace("/reset-password");
  } catch {
    hasRecoverySession.value = false;
  } finally {
    checkingSession.value = false;
  }
});

async function submitPasswordReset() {
  if (loading.value || !hasRecoverySession.value) return;
  if (newPassword.value.length < 8) {
    message("新密码至少需要 8 位", { type: "warning" });
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    message("两次输入的新密码不一致", { type: "warning" });
    return;
  }

  loading.value = true;
  try {
    await completePasswordReset({ password: newPassword.value });
    message("密码已重置，请使用新密码登录", { type: "success" });
    await router.replace("/login");
  } catch (error) {
    message(error instanceof Error ? error.message : "密码重置失败，请重新申请邮件", {
      type: "error"
    });
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-background px-5 py-12 text-foreground">
    <Card class="w-full max-w-md">
      <CardHeader class="space-y-3">
        <span class="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
          <ShieldCheck class="size-5" aria-hidden="true" />
        </span>
        <CardTitle>重置密码</CardTitle>
        <CardDescription>
          使用邮件中的安全链接设置新密码。密码至少需要 8 位。
        </CardDescription>
      </CardHeader>

      <CardContent>
        <p v-if="checkingSession" class="text-sm text-muted-foreground" role="status">
          正在验证重置链接…
        </p>
        <div v-else-if="!hasRecoverySession" class="space-y-4">
          <p class="text-sm text-destructive" role="alert">
            重置链接无效或已过期，请返回登录页重新申请。
          </p>
          <Button class="w-full" variant="outline" @click="router.replace('/login')">
            返回登录
          </Button>
        </div>
        <form v-else class="space-y-4" @submit.prevent="submitPasswordReset">
          <div class="space-y-2">
            <Label for="new-password">新密码</Label>
            <Input
              id="new-password"
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            />
          </div>
          <div class="space-y-2">
            <Label for="confirm-password">确认新密码</Label>
            <Input
              id="confirm-password"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            />
          </div>
          <Button class="w-full" type="submit" :disabled="loading">
            <LoaderCircle v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
            <span>{{ loading ? "正在保存" : "保存新密码" }}</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  </main>
</template>
