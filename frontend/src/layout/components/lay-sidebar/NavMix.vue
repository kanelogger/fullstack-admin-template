<script setup lang="ts">
import { computed } from "vue";
import { useAppStoreHook } from "@/store/modules/app";
import { usePermissionStoreHook } from "@/store/modules/permission";
import SidebarItem from "./components/SidebarItem.vue";
import SidebarHeaderActions from "./components/SidebarHeaderActions.vue";

const appStore = useAppStoreHook();
const permissionStore = usePermissionStoreHook();
const menus = computed(() => permissionStore.wholeMenus);
</script>

<template>
  <header v-if="appStore.device !== 'mobile'" class="horizontal-header flex min-w-0 items-center border-b border-border bg-background text-foreground">
    <nav aria-label="一级导航" class="min-w-0 flex-1 overflow-x-auto">
      <ul v-if="menus.length" class="horizontal-header-menu flex min-w-max items-center gap-1 px-2">
        <SidebarItem
          v-for="item in menus"
          :key="item.path"
          :item="item"
          :base-path="''"
          horizontal
        />
      </ul>
      <p v-else class="px-4 text-sm text-muted-foreground" role="status">当前账号没有可用菜单。</p>
    </nav>
    <SidebarHeaderActions class="horizontal-header-right" />
  </header>
</template>
