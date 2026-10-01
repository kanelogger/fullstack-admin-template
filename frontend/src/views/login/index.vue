<script setup lang="ts">
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { ref, reactive, watch } from "vue";
import { useNav } from "@/layout/hooks/useNav";
import { useUserStoreHook } from "@/store/modules/user";
import { initRouter, getTopMenu } from "@/router/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  UserRound
} from "@lucide/vue";
import Axios from "axios";

defineOptions({
  name: "Login"
});

const router = useRouter();
const loading = ref(false);
const disabled = ref(false);
const passwordVisible = ref(false);

const userStore = useUserStoreHook();

const { title } = useNav();

/** 免登录天数选项 */
const loginDayOptions = [
  { label: "7 天", value: 7 },
  { label: "14 天", value: 14 },
  { label: "30 天", value: 30 }
];

const ruleForm = reactive({
  username: "superadmin",
  password: "123456"
});

/** 记住登录状态 */
const isRemembered = ref(userStore.isRemembered);
/** 免登录天数 */
const loginDay = ref(userStore.loginDay);

// 同步 store
watch(isRemembered, val => userStore.SET_ISREMEMBERED(val));
watch(loginDay, val => userStore.SET_LOGINDAY(val));

/** 根据后端返回的错误码/信息，映射为对用户友好的提示 */
function resolveLoginError(res: any): string {
  const error = res?.error ?? res?.response?.data?.error ?? {};
  const msg = error?.message ?? res?.message ?? "";
  const code = error?.code ?? res?.code ?? res?.status;

  const codeMsgMap: Record<number | string, string> = {
    BAD_REQUEST: "请求参数有误，请检查输入",
    INVALID_CREDENTIALS: "账号或密码错误",
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

  if (code && codeMsgMap[code]) return codeMsgMap[code];

  if (msg) {
    if (/账号不存在|用户不存在|user not found/i.test(msg))
      return "账号不存在，请检查后重试";
    if (/密码错误|password.*incorrect|密码不匹配/i.test(msg))
      return "密码错误，请重新输入";
    if (/禁用|disabled|冻结|frozen/i.test(msg))
      return "账号已被禁用，请联系管理员";
    if (/锁定|locked/i.test(msg))
      return "账号已被锁定，请稍后再试";
    if (/验证码|captcha|验证失败/i.test(msg))
      return "验证码错误，请重新输入";
    return msg;
  }

  return "登录失败，请稍后重试";
}

/** 提取网络/HTTP 错误信息 */
function resolveNetworkError(error: any): string {
  if (Axios.isCancel(error)) return "请求已取消";

  const status = error?.response?.status;
  const apiError = error?.response?.data?.error;
  if (apiError?.message || apiError?.code) {
    return resolveLoginError({ error: apiError, status });
  }
  if (status) {
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

  if (error?.code === "ECONNABORTED" || error?.message?.includes("timeout"))
    return "请求超时，请检查网络后重试";
  if (error?.message?.includes("Network Error") || !error?.response)
    return "网络异常，请检查网络连接";

  return "网络异常，请稍后重试";
}

async function onLogin() {
  if (loading.value || disabled.value) return;

  loading.value = true;
  let loginSucceeded = false;
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
    await initRouter();
    disabled.value = true;
    try {
      await router.push(getTopMenu(true).path);
      message("登录成功", { type: "success" });
    } finally {
      disabled.value = false;
    }
  } catch (error) {
    if (loginSucceeded) {
      userStore.logOut();
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
    <section class="relative hidden overflow-hidden bg-slate-950 px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-16">
      <div class="absolute -right-36 -top-36 size-[32rem] rounded-full border border-white/10" />
      <div class="absolute -right-20 -top-20 size-[24rem] rounded-full border border-white/10" />
      <div class="absolute -bottom-40 -left-24 size-[30rem] rounded-full bg-blue-500/20 blur-3xl" />

      <div class="relative flex items-center gap-3 text-sm font-semibold tracking-wide">
        <span class="grid size-10 place-items-center rounded-xl bg-blue-500 text-white shadow-lg shadow-blue-950/40">
          <ShieldCheck class="size-5" aria-hidden="true" />
        </span>
        <span>ADMIN CONSOLE</span>
      </div>

      <div class="relative max-w-xl pb-14">
        <p class="mb-5 text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">Workspace access</p>
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
          <span class="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck class="size-5" aria-hidden="true" />
          </span>
          <span class="text-sm font-semibold tracking-wide">ADMIN CONSOLE</span>
        </div>

        <div class="mb-8">
          <p class="mb-3 text-sm font-medium text-primary">欢迎回来</p>
          <h1 class="text-3xl font-semibold tracking-tight">登录到工作台</h1>
          <p class="mt-2 text-sm text-muted-foreground">输入账号和密码，继续管理你的系统。</p>
        </div>

        <form class="space-y-5" @submit.prevent="onLogin">
          <div class="space-y-2">
            <Label for="username">账号</Label>
            <div class="relative">
              <UserRound class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="username"
                v-model="ruleForm.username"
                class="pl-10"
                autocomplete="username"
                placeholder="请输入账号"
                required
              />
            </div>
          </div>

          <div class="space-y-2">
            <Label for="password">密码</Label>
            <div class="relative">
              <LockKeyhole class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
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
          </div>

          <div class="flex min-h-9 items-center justify-between gap-4">
            <label for="remember-login" class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input
                id="remember-login"
                v-model="isRemembered"
                type="checkbox"
                class="size-4 rounded border-input accent-primary"
              />
              记住登录状态
            </label>
            <select
              v-if="isRemembered"
              v-model="loginDay"
              aria-label="免登录时长"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option v-for="item in loginDayOptions" :key="item.value" :value="item.value">
                {{ item.label }}
              </option>
            </select>
          </div>

          <Button class="w-full" type="submit" :disabled="loading || disabled">
            <LoaderCircle v-if="loading" class="size-4 animate-spin" aria-hidden="true" />
            <span>{{ loading ? "正在登录" : "登录" }}</span>
            <ArrowRight v-if="!loading" class="size-4" aria-hidden="true" />
          </Button>
        </form>

        <div class="mt-8 flex items-center gap-2 border-t border-border pt-5 text-xs text-muted-foreground">
          <ShieldCheck class="size-4 shrink-0" aria-hidden="true" />
          <span>你的登录信息将通过安全的后端接口验证。</span>
        </div>
      </div>
    </section>
  </main>
</template>
