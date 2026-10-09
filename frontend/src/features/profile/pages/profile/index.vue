<script setup lang="ts">
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { computed, onMounted, reactive, ref } from "vue";
import { message } from "@/utils/message";
import { useSessionStoreHook } from "@/stores/modules/session";
import { getCurrentSession, updateCurrentProfile } from "@/features/profile/profile.service";
import type { Profile, Session } from "@template/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LoaderCircle, RotateCw, Save } from "@lucide/vue";

defineOptions({ name: "ProfileInfo" });

const loading = ref(false);
const saving = ref(false);
const loadError = ref("");
const profile = ref<Profile | null>(null);
const roleCodes = ref<string[]>([]);
const userStore = useSessionStoreHook();
const form = reactive({ displayName: "", phone: "" });
const canSave = computed(() => form.displayName.trim().length > 0 && !saving.value);

function applyProfile(value: Profile) {
  profile.value = value;
  form.displayName = value.displayName;
  form.phone = value.phone ?? "";
}

async function loadProfile() {
  loading.value = true;
  loadError.value = "";
  try {
    const session: Session = await getCurrentSession();
    applyProfile(session.profile);
    roleCodes.value = session.roleCodes;
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "个人资料加载失败";
  } finally {
    loading.value = false;
  }
}

async function saveProfile() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    applyProfile(await updateCurrentProfile(form));
    userStore.SET_NICKNAME(profile.value?.displayName ?? "");
    userStore.SET_AVATAR(profile.value?.avatarUrl ?? "");
    message("个人资料已保存", { type: "success" });
  } catch (error) {
    message(error instanceof Error ? error.message : "个人资料保存失败", {
      type: "error"
    });
  } finally {
    saving.value = false;
  }
}

onMounted(loadProfile);
</script>

<template>
  <main class="mx-auto w-full max-w-5xl p-4 sm:p-6">
    <Card>
      <CardHeader class="flex flex-row items-start justify-between gap-4">
        <div class="space-y-1">
          <CardTitle>个人资料</CardTitle>
          <CardDescription>资料直接保存到 Supabase，登录名和邮箱由管理员维护。</CardDescription>
        </div>
        <Button :disabled="!canSave || loading" @click="saveProfile">
          <LoaderCircle v-if="saving" class="size-4 animate-spin" aria-hidden="true" />
          <Save v-else class="size-4" aria-hidden="true" />
          <span>{{ saving ? "正在保存" : "保存" }}</span>
        </Button>
      </CardHeader>

      <CardContent>
        <div
          v-if="loading"
          class="flex items-center gap-2 py-10 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
          正在读取个人资料…
        </div>

        <Alert variant="destructive" v-else-if="loadError"
          ><AlertDescription>
            <p class="text-sm text-destructive">{{ loadError }}</p>
            <Button variant="outline" size="sm" @click="loadProfile">
              <RotateCw class="size-4" aria-hidden="true" />
              重试
            </Button>
          </AlertDescription></Alert
        >

        <div
          v-else-if="profile"
          class="grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]"
        >
          <form @submit.prevent="saveProfile">
            <FieldGroup class="gap-5">
              <Field class="space-y-2">
                <FieldLabel for="profile-display-name">姓名</FieldLabel>
                <Input
                  id="profile-display-name"
                  v-model="form.displayName"
                  maxlength="128"
                  required
                />
              </Field>
              <Field class="space-y-2">
                <FieldLabel for="profile-phone">手机号</FieldLabel>
                <Input
                  id="profile-phone"
                  v-model="form.phone"
                  type="tel"
                  maxlength="32"
                  autocomplete="tel"
                />
              </Field>
              <Field class="space-y-2">
                <FieldLabel for="profile-login-name">登录名</FieldLabel>
                <Input id="profile-login-name" :model-value="profile.loginName" disabled />
              </Field>
              <Field class="space-y-2">
                <FieldLabel for="profile-email">已验证邮箱</FieldLabel>
                <Input id="profile-email" :model-value="profile.email" disabled />
              </Field>
            </FieldGroup>
          </form>

          <aside class="space-y-4 rounded-lg bg-muted/40 p-5">
            <div>
              <p class="text-sm font-medium">账号状态</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ profile.isActive ? "正常" : "已停用" }}
              </p>
            </div>
            <div>
              <p class="text-sm font-medium">角色</p>
              <p class="mt-1 text-sm text-muted-foreground">
                {{ roleCodes.length ? roleCodes.join("、") : "尚未分配角色" }}
              </p>
            </div>
            <p class="text-xs leading-5 text-muted-foreground">
              邮箱和角色变更需要管理员处理。密码通过已验证邮箱重置。
            </p>
          </aside>
        </div>
      </CardContent>
    </Card>
  </main>
</template>
