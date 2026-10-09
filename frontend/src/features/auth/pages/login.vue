<script setup lang="ts">
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { ref, reactive } from "vue";
import { getConfig } from "@/config";
import { useSessionStoreHook } from "@/stores/modules/session";
import { requestPasswordReset } from "@/features/auth/auth.service";
import { getTopMenu } from "@/router/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UserRound
} from "@lucide/vue";

defineOptions({
  name: "Login"
});

const router = useRouter();
const loading = ref(false);
const resetLoading = ref(false);
const disabled = ref(false);
const passwordVisible = ref(false);

const userStore = useSessionStoreHook();

const title = getConfig().Title;

const ruleForm = reactive({
  username: "",
  password: ""
});

/** 根据后端返回的错误码/信息，映射为对用户友好的提示 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function resolveLoginError(res: unknown): string {
  const response = asRecord(asRecord(res)?.response);
  const responseData = asRecord(response?.data);
  const result = asRecord(res);
  const error = asRecord(result?.error) ?? asRecord(responseData?.error) ?? {};
  const msgValue = error.message ?? result?.message ?? "";
  const msg = typeof msgValue === "string" ? msgValue : "";
  const code = error.code ?? result?.code ?? result?.status;

  const codeMsgMap: Record<number | string, string> = {
    BAD_REQUEST: "请求参数有误，请检查输入",
    INVALID_CREDENTIALS: "账号或密码错误；如账号需要强制重置，请使用忘记密码申请邮件链接",
    USER_DISABLED: "账号已被禁用，请联系管理员",
    UNAUTHORIZED: "登录已过期，请重新登录",
    INTERNAL_ERROR: "服务器异常，请稍后重试",
    400: "请求参数有误，请检查输入",
    401: "账号或密码错误",
    403: "账号已被禁用，请联系管理员",
    404: "账号不存在",
    423: "账号已被锁定，请稍后再试",
    429: "操作过于频繁，请稍后再试",
    500: "服务器异常，请稍后重试",
    502: "网关异常，请稍后重试",
    503: "服务暂不可用，请稍后重试",
    504: "请求超时，请检查网络后重试"
  };

  if ((typeof code === "string" || typeof code === "number") && codeMsgMap[code]) {
    return codeMsgMap[code];
  }

  if (msg) {
    if (/账号不存在|用户不存在|user not found/i.test(msg)) return "账号不存在，请检查后重试";
    if (/密码错误|password.*incorrect|密码不匹配/i.test(msg)) return "密码错误，请重新输入";
    if (/禁用|disabled|冻结|frozen/i.test(msg)) return "账号已被禁用，请联系管理员";
    if (/锁定|locked/i.test(msg)) return "账号已被锁定，请稍后再试";
    return msg;
  }

  return "登录失败，请稍后重试";
}

async function onRequestPasswordReset() {
  const loginName = ruleForm.username.trim();
  if (!loginName || resetLoading.value) {
    message("请先输入登录账号", { type: "warning" });
    return;
  }

  resetLoading.value = true;
  try {
    const result = await requestPasswordReset({ loginName });
    if (result.success === false) {
      message(result.error.message, { type: "error" });
      return;
    }
    message(result.data.message, { type: "success" });
  } catch (error) {
    message(resolveNetworkError(error), { type: "error" });
  } finally {
    resetLoading.value = false;
  }
}

/** 提取网络/HTTP 错误信息 */
function resolveNetworkError(error: unknown): string {
  const result = asRecord(error);
  const response = asRecord(result?.response);
  const responseData = asRecord(response?.data);
  const apiError = asRecord(responseData?.error);
  const status = response?.status;

  if (result?.code === "ERR_CANCELED" || result?.name === "CanceledError") {
    return "请求已取消";
  }

  if (apiError?.message || apiError?.code) {
    return resolveLoginError({ error: apiError, status });
  }
  if (typeof status === "number") {
    const statusMap: Record<number, string> = {
      400: "请求参数有误",
      401: "账号或密码错误",
      403: "账号已被禁用，请联系管理员",
      404: "账号不存在",
      423: "账号已被锁定，请稍后再试",
      429: "操作过于频繁，请稍后再试",
      500: "服务器异常，请稍后重试",
      502: "网关异常，请稍后重试",
      503: "服务暂不可用，请稍后重试",
      504: "请求超时，请检查网络后重试"
    };
    if (statusMap[status]) return statusMap[status];
    return `服务器错误（${status}），请稍后重试`;
  }

  const errorMessage = typeof result?.message === "string" ? result.message : "";
  if (result?.code === "ECONNABORTED" || errorMessage.includes("timeout"))
    return "请求超时，请检查网络后重试";
  if (errorMessage.includes("Network Error") || !response) return "网络异常，请检查网络连接";

  return "网络异常，请稍后重试";
}

async function onLogin() {
  if (loading.value || disabled.value) return;

  loading.value = true;
  let loginSucceeded = false;
  let loginIdentity: { authUserId: string; sessionId: string } | null = null;
  try {
    const res = await userStore.loginByUsername({
      username: ruleForm.username,
      password: ruleForm.password
    });

    if (!res.success) {
      message(resolveLoginError(res), { type: "error" });
      return;
    }

    loginSucceeded = true;
    const expectedIdentity = {
      authUserId: res.data.profile.authUserId,
      sessionId: res.authSessionId
    };
    loginIdentity = expectedIdentity;
    if (!(await userStore.initSessionNavigation(expectedIdentity))) return;
    if (!(await userStore.isCurrentPersistedAuthSession(expectedIdentity))) return;
    disabled.value = true;
    try {
      const landingMenu = getTopMenu();
      if (!landingMenu?.path) throw new Error("当前账号没有可访问菜单");
      if (!(await userStore.isCurrentPersistedAuthSession(expectedIdentity))) return;
      await router.push(landingMenu.path);
      message("登录成功", { type: "success" });
    } finally {
      disabled.value = false;
    }
  } catch (error) {
    if (loginSucceeded && loginIdentity) {
      const logout = await userStore.logOut(loginIdentity).catch(() => ({
        serverSessionRevoked: false,
        ignored: true
      }));
      if (logout.ignored) return;
      message("登录成功，但菜单权限加载失败，请检查服务后重试", {
        type: "error"
      });
    } else {
      message(resolveNetworkError(error), { type: "error" });
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
    <section
      class="relative hidden overflow-hidden bg-slate-950 px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16"
    >
      <div class="absolute -right-36 -top-36 size-[32rem] rounded-full border border-white/10" />
      <div class="absolute -right-20 -top-20 size-[24rem] rounded-full border border-white/10" />
      <div class="absolute -bottom-40 -left-24 size-[30rem] rounded-full bg-blue-500/20 blur-3xl" />

      <div class="relative flex items-center gap-3 text-sm font-semibold tracking-wide">
        <span
          class="grid size-10 place-items-center rounded-xl bg-blue-500 text-white shadow-lg shadow-blue-950/40"
        >
          <ShieldCheck class="size-5" aria-hidden="true" />
        </span>
        <span>ADMIN CONSOLE</span>
      </div>

      <div class="relative max-w-xl pb-14">
        <p class="mb-5 text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
          Workspace access
        </p>
        <h2 class="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
          让管理工作，<br />回到清晰有序。
        </h2>
        <p class="mt-6 max-w-md text-base leading-7 text-slate-300">
          安全访问组织、权限与运营数据，在一个工作台中掌握系统状态。
        </p>
      </div>

      <p class="relative text-xs text-slate-400">{{ title }} · 管理后台</p>
    </section>

    <section class="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
      <div class="w-full max-w-sm">
        <div class="mb-10 flex items-center gap-3 lg:hidden">
          <span
            class="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"
          >
            <ShieldCheck class="size-5" aria-hidden="true" />
          </span>
          <span class="text-sm font-semibold tracking-wide">ADMIN CONSOLE</span>
        </div>

        <div class="mb-8">
          <p class="mb-3 text-sm font-medium text-primary">欢迎回来</p>
          <h1 class="text-3xl font-semibold tracking-tight">登录到工作台</h1>
          <p class="mt-2 text-sm text-muted-foreground">输入账号和密码，继续管理你的系统。</p>
        </div>

        <form @submit.prevent="onLogin">
          <FieldGroup class="gap-5">
            <Field class="space-y-2">
              <FieldLabel for="username">账号</FieldLabel>
              <div class="relative">
                <UserRound
                  class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="username"
                  v-model="ruleForm.username"
                  class="pl-10"
                  autocomplete="username"
                  placeholder="请输入账号"
                  required
                />
              </div>
            </Field>

            <Field class="space-y-2">
              <FieldLabel for="password">密码</FieldLabel>
              <div class="relative">
                <LockKeyhole
                  class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  id="password"
                  v-model="ruleForm.password"
                  class="pl-10 pr-11"
                  :type="passwordVisible ? 'text' : 'password'"
                  autocomplete="current-password"
                  placeholder="请输入密码"
                  minlength="6"
                  required
                />
                <button
                  type="button"
                  class="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  :aria-label="passwordVisible ? '隐藏密码' : '显示密码'"
                  @click="passwordVisible = !passwordVisible"
                >
                  <EyeOff v-if="passwordVisible" class="size-4" aria-hidden="true" />
                  <Eye v-else class="size-4" aria-hidden="true" />
                </button>
              </div>
            </Field>

            <div class="flex min-h-9 items-center justify-between gap-4">
              <button
                class="shrink-0 text-sm text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                :disabled="loading || resetLoading"
                @click="onRequestPasswordReset"
              >
                {{ resetLoading ? "正在发送重置邮件" : "忘记密码？" }}
              </button>
            </div>

            <Button class="w-full" type="submit" :disabled="loading || disabled">
              <LoaderCircle v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
              <span>{{ loading ? "正在登录" : "登录" }}</span>
              <ArrowRight v-if="!loading" class="size-4" aria-hidden="true" />
            </Button>
          </FieldGroup>
        </form>

        <div
          class="mt-8 flex items-center gap-2 border-t border-border pt-5 text-xs text-muted-foreground"
        >
          <ShieldCheck class="size-4 shrink-0" aria-hidden="true" />
          <span>使用账号和密码登录，邮箱仅用于密码重置。</span>
        </div>
      </div>
    </section>
  </main>
</template>
