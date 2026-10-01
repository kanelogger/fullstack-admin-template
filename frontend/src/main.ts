import App from "./App.vue";
import router from "./router";
import { setupStore } from "@/store";
import { getConfig, getPlatformConfig } from "./config";
import { MotionPlugin } from "@vueuse/motion";
// import { useEcharts } from "@/plugins/echarts";
import { createApp, type Directive } from "vue";
import { useElementPlus } from "@/plugins/elementPlus";
import { injectResponsiveStorage } from "@/utils/responsive";

import Table from "@pureadmin/table";
// import PureDescriptions from "@pureadmin/descriptions";

// Tailwind 先声明样式层，基础重置随后进入 base 层，utility 类可以覆盖原生控件重置。
import "./style/tailwind.css";
import "./style/reset.scss";
import "./style/index.scss";
import "element-plus/dist/index.css";

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
  const configuredPrimary = platformConfig.EpThemeColor;
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
  app.use(router);
  await router.isReady();
  injectResponsiveStorage(app, platformConfig);
  app.use(MotionPlugin).use(useElementPlus).use(Table);
  // .use(PureDescriptions)
  // .use(useEcharts);
  app.mount("#app");
});
