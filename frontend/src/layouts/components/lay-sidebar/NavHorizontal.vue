<script setup lang="ts">
import { computed } from "vue";
import { getConfig } from "@/config";
import { getTopMenu } from "@/router/utils";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import SidebarItem from "./components/SidebarItem.vue";
import SidebarHeaderActions from "./components/SidebarHeaderActions.vue";

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
    <nav aria-label="主导航" class="min-w-0 flex-1 overflow-x-auto">
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
