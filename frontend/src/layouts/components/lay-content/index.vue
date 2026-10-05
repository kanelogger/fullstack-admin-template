<script setup lang="ts">
import LayFrame from "../lay-frame/index.vue";
import LayFooter from "../lay-footer/index.vue";
import { getConfig } from "@/config";
import { useScroll } from "@vueuse/core";
import { Button } from "@/components/ui/button";
import { h, computed, ref, Transition, defineComponent } from "vue";
import { usePermissionStoreHook } from "@/stores/modules/permission";

const props = defineProps({
  fixedHeader: Boolean
});

const isKeepAlive = computed(() => {
  return getConfig().KeepAlive;
});

const scrollRef = ref<HTMLElement | null>(null);
const { y: scrollPosition } = useScroll(scrollRef);
const showBackTop = computed(() => scrollPosition.value > 240);

function scrollToTop() {
  scrollRef.value?.scrollTo({ top: 0, behavior: "smooth" });
}

const transitions = computed(() => {
  return route => {
    return route.meta.transition;
  };
});

const hideTabs = getConfig().HideTabs ?? false;
const hideFooter = getConfig().HideFooter ?? false;
const showModel = getConfig().ShowModel || "smart";

const layout = computed(() => {
  return getConfig().Layout === "vertical";
});

const getSectionStyle = computed(() => {
  return [
    hideTabs && layout.value ? "padding-top: 48px;" : "",
    !hideTabs && layout.value
      ? showModel == "chrome"
        ? "padding-top: 85px;"
        : "padding-top: 81px;"
      : "",
    hideTabs && !layout.value ? "padding-top: 48px;" : "",
    !hideTabs && !layout.value
      ? showModel == "chrome"
        ? "padding-top: 85px;"
        : "padding-top: 81px;"
      : "",
    props.fixedHeader
      ? ""
      : `padding-top: 0;${
          hideTabs
            ? "min-height: calc(100vh - 48px);"
            : "min-height: calc(100vh - 86px);"
        }`
  ];
});

const transitionMain = defineComponent({
  props: {
    route: {
      type: undefined,
      required: true
    }
  },
  render() {
    const transitionName =
      transitions.value(this.route)?.name || "fade-transform";
    const enterTransition = transitions.value(this.route)?.enterTransition;
    const leaveTransition = transitions.value(this.route)?.leaveTransition;
    return h(
      Transition,
      {
        name: enterTransition ? "layout-classes-transition" : transitionName,
        enterActiveClass: enterTransition
          ? `animate__animated ${enterTransition}`
          : undefined,
        leaveActiveClass: leaveTransition
          ? `animate__animated ${leaveTransition}`
          : undefined,
        mode: "out-in",
        appear: true
      },
      {
        default: () => [this.$slots.default()]
      }
    );
  }
});
</script>

<template>
  <section
    :class="[fixedHeader ? 'app-main' : 'app-main-nofixed-header']"
    :style="getSectionStyle"
  >
    <router-view>
      <template #default="{ Component, route }">
        <LayFrame :currComp="Component" :currRoute="route">
          <template #default="{ Comp, fullPath, frameInfo }">
            <template v-if="fixedHeader">
              <div
                ref="scrollRef"
                class="app-scrollbar h-full w-full overflow-x-hidden overflow-y-auto"
              >
                <div class="mx-auto flex min-h-full w-full flex-col transition-all duration-300">
                  <div class="grow">
                    <transitionMain :route="route">
                      <keep-alive
                        v-if="isKeepAlive"
                        :include="usePermissionStoreHook().cachePageList"
                      >
                        <component
                          :is="Comp"
                          :key="fullPath"
                          :frameInfo="frameInfo"
                          class="main-content"
                        />
                      </keep-alive>
                      <component
                        :is="Comp"
                        v-else
                        :key="fullPath"
                        :frameInfo="frameInfo"
                        class="main-content"
                      />
                    </transitionMain>
                  </div>
                  <LayFooter v-if="!hideFooter" />
                </div>
              </div>
              <Button
                v-if="showBackTop"
                class="fixed bottom-6 right-6 z-40 size-10 rounded-full shadow-md"
                size="icon"
                variant="outline"
                aria-label="回到顶部"
                @click="scrollToTop"
              >↑</Button>
            </template>
            <div v-else class="grow">
              <transitionMain :route="route">
                <keep-alive
                  v-if="isKeepAlive"
                  :include="usePermissionStoreHook().cachePageList"
                >
                  <component
                    :is="Comp"
                    :key="fullPath"
                    :frameInfo="frameInfo"
                    class="main-content"
                  />
                </keep-alive>
                <component
                  :is="Comp"
                  v-else
                  :key="fullPath"
                  :frameInfo="frameInfo"
                  class="main-content"
                />
              </transitionMain>
            </div>
          </template>
        </LayFrame>
      </template>
    </router-view>

    <!-- 页脚 -->
    <LayFooter v-if="!hideFooter && !fixedHeader" />
  </section>
</template>

<style scoped>
.app-main {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow-x: hidden;
}

.app-main-nofixed-header {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
}

.main-content {
  margin: 24px;
}
</style>
