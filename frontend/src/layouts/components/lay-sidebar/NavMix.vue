<script setup lang="ts">
import { computed } from "vue";
import { useUiStoreHook } from "@/stores/modules/ui";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import SidebarHeaderActions from "./components/SidebarHeaderActions.vue";
import HorizontalMenu from "./HorizontalMenu.vue";

const appStore = useUiStoreHook();
const permissionStore = usePermissionStoreHook();
const menus = computed(() => permissionStore.wholeMenus);
</script>

<template>
  <header
    v-if="appStore.device !== 'mobile'"
    class="horizontal-header flex min-w-0 items-center border-b border-border bg-background text-foreground"
  >
    <HorizontalMenu :items="menus" label="一级导航" />
    <SidebarHeaderActions class="horizontal-header-right" />
  </header>
</template>
