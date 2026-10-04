<script setup lang="ts">
import { ref } from "vue";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import { requestPasswordReset } from "@/features/auth/auth.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoaderCircle, Mail } from "@lucide/vue";

defineOptions({ name: "ProfileChangePassword" });

const userStore = useUserStoreHook();
const sending = ref(false);

async function sendResetLink() {
  if (sending.value) return;
  sending.value = true;
  try {
    const result = await requestPasswordReset({ loginName: userStore.username });
    if (result.success === false) {
      message(result.error.message, { type: "error" });
      return;
    }
    message(result.data.message, { type: "success" });
  } catch (error) {
    message(error instanceof Error ? error.message : "重置邮件发送失败", {
      type: "error"
    });
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <main class="mx-auto w-full max-w-2xl p-4 sm:p-6">
    <Card>
      <CardHeader>
        <CardTitle>重置密码</CardTitle>
        <CardDescription>
          为保护账号，密码通过已验证邮箱重置。邮件中的链接只在本机 Supabase Auth 配置的有效期内可用。
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">登录名：{{ userStore.username }}</p>
        <Button :disabled="sending" @click="sendResetLink">
          <LoaderCircle v-if="sending" class="size-4 animate-spin" aria-hidden="true" />
          <Mail v-else class="size-4" aria-hidden="true" />
          {{ sending ? "正在发送" : "发送重置邮件" }}
        </Button>
      </CardContent>
    </Card>
  </main>
</template>
