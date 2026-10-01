import { h, defineComponent, type Component, type PropType } from "vue";
import {
  Icon as IconifyIcon,
  type IconifyIcon as IconifyIconData
} from "@iconify/vue/dist/offline";

// Iconify Icon在Vue里本地使用（用于内网环境）
export default defineComponent({
  name: "IconifyIconOffline",
  components: { IconifyIcon },
  props: {
    icon: {
      type: [String, Object] as PropType<
        string | IconifyIconData | Component
      >,
      default: null
    }
  },
  render() {
    const attrs = this.$attrs;
    const style = attrs?.style
      ? Object.assign(attrs.style, { outline: "none" })
      : { outline: "none" };

    if (
      this.icon &&
      typeof this.icon === "object" &&
      "body" in this.icon
    ) {
      return h(IconifyIcon, {
        icon: this.icon as IconifyIconData,
        "aria-hidden": false,
        style,
        ...attrs
      });
    }

    if (typeof this.icon === "string") {
      return h(
        IconifyIcon,
        {
          icon: this.icon,
          "aria-hidden": false,
          style,
          ...attrs
        },
        {
          default: () => []
        }
      );
    } else if (this.icon) {
      return h(
        this.icon,
        {
          "aria-hidden": false,
          style,
          ...attrs
        },
        {
          default: () => []
        }
      );
    }

    return null;
  }
});
