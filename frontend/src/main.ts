import App from "./app/App.vue";
import router from "./router";
import { setupStore } from "@/stores";
import { getConfig, getPlatformConfig } from "./config";
import { MotionPlugin } from "@vueuse/motion";
import { createApp } from "vue";
import { injectResponsiveStorage } from "@/utils/responsive";
import { getSupabaseClientIfConfigured } from "@/lib/supabase/client";
import { useSessionStoreHook } from "@/stores/modules/session";
import { getAuthSessionIdentity } from "@/features/auth/session-identity";

// Tailwind 先声明样式层，基础重置随后进入 base 层，utility 类可以覆盖原生控件重置。
import "./style/tailwind.css";
import "./style/reset.scss";
import "./style/index.scss";

const app = createApp(App);

// 全局注册@iconify/vue图标库
import {
  IconifyIconOffline,
  IconifyIconOnline,
  FontIcon
} from "./components/ReIcon";
app.component("IconifyIconOffline", IconifyIconOffline);
app.component("IconifyIconOnline", IconifyIconOnline);
app.component("FontIcon", FontIcon);

getPlatformConfig(app).then(async () => {
  const platformConfig = getConfig();
  const configuredPrimary = platformConfig.PrimaryColor;
  if (
    typeof configuredPrimary === "string" &&
    CSS.supports("color", configuredPrimary)
  ) {
    document.documentElement.style.setProperty(
      "--app-primary",
      configuredPrimary
    );
  }

  setupStore(app);
  const userStore = useSessionStoreHook();
  const supabase = getSupabaseClientIfConfigured();
  supabase?.auth.onAuthStateChange((event, authSession) => {
    if (event === "SIGNED_OUT") {
      window.setTimeout(() => {
        void supabase.auth.getSession().then(({ data, error }) => {
          if (error) return;
          const currentIdentity = getAuthSessionIdentity(data.session);
          if (currentIdentity) {
            userStore.observeAuthSession(currentIdentity);
            void userStore.refreshAuthorization(true);
            return;
          }
          if (userStore.isAuthenticated || !userStore.authReady) userStore.clearLocalSession();
          if (
            router.currentRoute.value.path !== "/login" &&
            router.currentRoute.value.path !== "/reset-password"
          ) {
            void router.replace("/login");
          }
        }).catch(() => undefined);
      }, 0);
      return;
    }

    const identity = getAuthSessionIdentity(authSession);
    const sessionChanged = identity && userStore.authReady
      ? userStore.observeAuthSession(identity)
      : false;
    const signedInSessionNeedsRestore = event === "SIGNED_IN" &&
      Boolean(identity) &&
      userStore.authReady &&
      !userStore.isAuthenticated;
    if (
      event === "TOKEN_REFRESHED" ||
      event === "USER_UPDATED" ||
      sessionChanged ||
      signedInSessionNeedsRestore
    ) {
      // Supabase Auth callbacks run under an internal lock. Defer follow-up
      // Auth/PostgREST requests until the callback has returned.
      window.setTimeout(() => {
        if (
          event === "SIGNED_IN" &&
          identity &&
          userStore.isAuthenticated &&
          userStore.authUserId === identity.authUserId &&
          userStore.authSessionId === identity.sessionId
        ) return;
        void userStore.refreshAuthorization(true);
      }, 0);
    }
  });

  const refreshVisibleSession = (forceRefresh: boolean) => {
    if (
      document.visibilityState !== "visible" ||
      !userStore.isAuthenticated
    ) return;
    void userStore.refreshAuthorization(forceRefresh, forceRefresh);
  };
  document.addEventListener("visibilitychange", () => refreshVisibleSession(true));
  window.addEventListener("focus", () => refreshVisibleSession(true));
  window.setInterval(() => refreshVisibleSession(false), 60_000);

  app.use(router);
  await router.isReady();
  injectResponsiveStorage(app, platformConfig);
  app.use(MotionPlugin);
  app.mount("#app");
});
