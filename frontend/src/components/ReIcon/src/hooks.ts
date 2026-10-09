import type { iconType } from "./types";
import { h, defineComponent, type Component } from "vue";
import type { IconifyIcon as IconifyIconData } from "@iconify/vue/dist/offline";
import { FontIcon, IconifyIconOnline, IconifyIconOffline } from "../index";

/**
 * 支持 `iconfont`、自定义 `svg` 以及 `iconify` 中所有的图标
 * @see 点击查看文档图标篇 {@link https://admin.cn/pages/icon/}
 * @param icon 必传 图标
 * @param attrs 可选 iconType 属性
 * @returns Component
 */
export function useRenderIcon(
  icon: string | Component | IconifyIconData,
  attrs?: iconType
): Component {
  // iconfont
  const ifReg = /^IF-/;
  // typeof icon === "function" 属于SVG
  if (typeof icon === "string" && ifReg.test(icon)) {
    // iconfont
    const name = icon.split(ifReg)[1];
    const iconName = name.slice(0, name.indexOf(" ") == -1 ? name.length : name.indexOf(" "));
    const iconType = name.slice(name.indexOf(" ") + 1, name.length);
    return defineComponent({
      name: "FontIcon",
      render() {
        return h(FontIcon, {
          icon: iconName,
          iconType,
          ...attrs
        });
      }
    });
  } else if (typeof icon === "object" && icon !== null && "body" in icon) {
    return defineComponent({
      name: "OfflineIcon",
      render() {
        return h(IconifyIconOffline, { icon, ...attrs });
      }
    });
  } else if (typeof icon === "function" || typeof icon === "object") {
    // svg
    const component = icon as Component;
    return attrs ? defineComponent({ render: () => h(component, { ...attrs }) }) : component;
  } else {
    // 通过是否存在 : 符号来判断是在线还是本地图标，存在即是在线图标，反之
    return defineComponent({
      name: "Icon",
      render() {
        if (!icon) return;
        if (typeof icon !== "string") return;
        const IconifyIcon = icon.includes(":") ? IconifyIconOnline : IconifyIconOffline;
        return h(IconifyIcon, {
          icon,
          ...attrs
        });
      }
    });
  }
}
