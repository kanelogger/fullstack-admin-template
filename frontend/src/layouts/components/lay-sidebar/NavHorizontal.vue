<script setup lang="ts">
import { computed } from "vue";
import { getConfig } from "@/config";
import { getTopMenu } from "@/router/utils";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import SidebarHeaderActions from "./components/SidebarHeaderActions.vue";
import HorizontalMenu from "./HorizontalMenu.vue";

const permissionStore = usePermissionStoreHook();
const title = getConfig().Title || "Admin";
const showLogo = getConfig().ShowLogo ?? true;
const homePath = getTopMenu()?.path ?? "/";
const menus = computed(() => permissionStore.wholeMenus);
</script>

<template>
  <header class="horizontal-header flex min-w-0 items-center border-b border-border bg-background text-foreground">
    <RouterLink v-if="showLogo" :to="homePath" class="horizontal-header-left shrink-0 text-sm text-foreground">
      <span class="grid size-8 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">{{ title.slice(0, 1).toUpperCase() }}</span>
      <span class="truncate">{{ title }}</span>
    </RouterLink>
    <HorizontalMenu :items="menus" label="主导航" />
    <SidebarHeaderActions class="horizontal-header-right" />
  </header>
</template>
