import type { VNode } from "vue";

declare module "*.tsx" {
  import Vue from "compatible-vue";
  export default Vue;
}

declare global {
  namespace JSX {
    // eslint-disable-next-line
    interface Element extends VNode {}
    // eslint-disable-next-line
    interface ElementClass extends Vue {}
    interface ElementAttributesProperty {
      $props: Record<string, unknown>;
    }
    interface IntrinsicElements {
      [elem: string]: Record<string, unknown>;
    }
    interface IntrinsicAttributes {
      [elem: string]: Record<string, unknown>;
    }
  }
}
