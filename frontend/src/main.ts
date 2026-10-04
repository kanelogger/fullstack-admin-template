import App from "./App.vue";
import router from "./router";
import { setupStore } from "@/store";
import { getConfig, getPlatformConfig } from "./config";
import { MotionPlugin } from "@vueuse/motion";
import { createApp, type Directive } from "vue";
import { injectResponsiveStorage } from "@/utils/responsive";
import { getSupabaseClientIfConfigured } from "@/shared/supabase/client";
import { useUserStoreHook } from "@/store/modules/user";

// Tailwind 先声明样式层，基础重置随后进入 base 层，utility 类可以覆盖原生控件重置。
import "./style/tailwind.css";
import "./style/reset.scss";
import "./style/index.scss";

const app = createApp(App);

// 自定义指令
import * as directives from "@/directives";
Object.keys(directives).forEach(key => {
  app.directive(key, (directives as { [key: string]: Directive })[key]);
});

// 全局注册@iconify/vue图标库
import {
  IconifyIconOffline,
  IconifyIconOnline,
  FontIcon
} from "./components/ReIcon";
app.component("IconifyIconOffline", IconifyIconOffline);
app.component("IconifyIconOnline", IconifyIconOnline);
app.component("FontIcon", FontIcon);

// 全局注册按钮级别权限组件
import { Auth } from "@/components/ReAuth";
import { Perms } from "@/components/RePerms";
app.component("Auth", Auth);
app.component("Perms", Perms);

// 全局注册vue-tippy
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light.css";
import VueTippy from "vue-tippy";
app.use(VueTippy);

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
  const supabase = getSupabaseClientIfConfigured();
  supabase?.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") {
      useUserStoreHook().clearLocalSession();
    }
  });
  app.use(router);
  await router.isReady();
  injectResponsiveStorage(app, platformConfig);
  app.use(MotionPlugin);
  app.mount("#app");
});
