<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/config";
import { initRouter } from "@/router/utils";
import { emitter } from "@/utils/mitt";
import { useUiStoreHook } from "@/stores/modules/ui";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import SidebarItem from "./components/SidebarItem.vue";
import SidebarLogo from "./components/SidebarLogo.vue";
import SidebarLeftCollapse from "./components/SidebarLeftCollapse.vue";
import SidebarCenterCollapse from "./components/SidebarCenterCollapse.vue";

const route = useRoute();
const appStore = useUiStoreHook();
const permissionStore = usePermissionStoreHook();
const menuError = ref("");
const loadState = ref<"loading" | "ready" | "empty" | "error">("loading");
const isHovered = ref(false);
let emptyTimer: ReturnType<typeof setTimeout> | undefined;

const collapsed = computed(() => !appStore.sidebar.opened);
const isMobile = computed(() => appStore.device === "mobile");
const showLogo = getConfig().ShowLogo ?? true;
const activePath = computed(() => String(route.meta.activePath ?? route.path));
const menuData = computed(() => {
  if (appStore.layout !== "mix" || isMobile.value) return permissionStore.wholeMenus;
  const parentPaths = getParentPath(activePath.value, permissionStore.wholeMenus);
  const parent = findByPath(parentPaths[0] ?? activePath.value, permissionStore.wholeMenus);
  return parent?.children ?? permissionStore.wholeMenus;
});

watch(
  () => permissionStore.wholeMenus,
  menus => {
    if (emptyTimer) clearTimeout(emptyTimer);
    menuError.value = "";
    if (menus.length) {
      loadState.value = "ready";
      return;
    }
    loadState.value = "loading";
    emptyTimer = setTimeout(() => {
      loadState.value = "empty";
    }, 700);
  },
  { immediate: true }
);

watch(
  () => [route.path, permissionStore.wholeMenus],
  () => {
    if (!route.path.includes("/redirect")) {
      emitter.emit("changLayoutRoute", route.path);
    }
  }
);

async function retryMenus() {
  loadState.value = "loading";
  menuError.value = "";
  try {
    await initRouter();
    loadState.value = permissionStore.wholeMenus.length ? "ready" : "empty";
    if (!permissionStore.wholeMenus.length) {
      menuError.value = "服务器没有返回可用菜单，请检查当前账号的菜单授权。";
      loadState.value = "error";
    }
  } catch (error) {
    menuError.value = error instanceof Error ? error.message : "菜单加载失败，请重试。";
    loadState.value = "error";
  }
}

function toggleSidebar() {
  void appStore.toggleSideBar();
}

function getParentPath(path: string, menus: any[], parents: string[] = []): string[] {
  for (const menu of menus) {
    const fullPath = resolvePath("", menu.path ?? "");
    if (fullPath === path || path.startsWith(`${fullPath}/`)) {
      const descendants = menu.children?.length
        ? getParentPath(path, menu.children, [...parents, fullPath])
        : [];
      return descendants.length ? descendants : [...parents, fullPath];
    }
  }
  return parents;
}

function findByPath(path: string, menus: any[]): any | undefined {
  for (const menu of menus) {
    if (resolvePath("", menu.path ?? "") === path) return menu;
    const nested = menu.children?.length ? findByPath(path, menu.children) : undefined;
    if (nested) return nested;
  }
}

function resolvePath(base: string, path: string): string {
  if (path.startsWith("/")) return path;
  return `${base.replace(/\/$/, "")}/${path}`.replace(/\/+/g, "/") || "/";
}

onBeforeUnmount(() => {
  if (emptyTimer) clearTimeout(emptyTimer);
});
</script>

<template>
  <aside
    :class="[
      'sidebar-container flex flex-col bg-background text-foreground',
      showLogo ? 'has-logo' : 'no-logo',
      collapsed ? 'sidebar-collapsed' : '',
      isMobile ? 'mobile' : 'pc'
    ]"
    aria-label="主导航"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <SidebarLogo v-if="showLogo" :collapse="collapsed" />
    <div class="sidebar-menu-scroll min-h-0 flex-1 overflow-y-auto px-2 py-3">
      <ul v-if="loadState === 'ready'" class="space-y-1 p-0">
        <SidebarItem
          v-for="item in menuData"
          :key="item.path"
          :item="item"
          :base-path="''"
          :collapsed="collapsed"
        />
      </ul>
      <div v-else-if="loadState === 'loading'" class="space-y-3 p-3" role="status" aria-label="正在加载菜单">
        <div v-for="index in 5" :key="index" class="h-9 animate-pulse rounded-md bg-muted/70" />
      </div>
      <div v-else-if="loadState === 'empty'" class="space-y-2 p-3 text-sm text-muted-foreground" role="status">
        <p>当前账号没有可用菜单。</p>
        <Button size="sm" variant="outline" class="w-full" @click="retryMenus">重新加载</Button>
      </div>
      <div v-else class="space-y-2 p-3 text-sm" role="alert">
        <p class="text-destructive">{{ menuError }}</p>
        <Button size="sm" variant="outline" class="w-full" @click="retryMenus">重试菜单加载</Button>
      </div>
    </div>
    <SidebarCenterCollapse
      v-if="!isMobile && (isHovered || collapsed)"
      :is-active="appStore.sidebar.opened"
      @toggle-click="toggleSidebar"
    />
    <SidebarLeftCollapse
      v-if="!isMobile"
      :is-active="appStore.sidebar.opened"
      @toggle-click="toggleSidebar"
    />
  </aside>
</template>

<style scoped>
.sidebar-container {
  box-sizing: border-box;
  width: 210px !important;
  font-size: 0.875rem;
}

.sidebar-container.sidebar-collapsed {
  width: 54px !important;
}

.sidebar-container.has-logo .sidebar-menu-scroll {
  height: calc(100% - 92px);
}

.sidebar-container.no-logo .sidebar-menu-scroll {
  height: calc(100% - 44px);
}

.sidebar-container.mobile {
  width: min(280px, 82vw) !important;
}
</style>
