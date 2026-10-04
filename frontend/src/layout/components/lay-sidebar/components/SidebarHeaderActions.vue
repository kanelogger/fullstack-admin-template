<script setup lang="ts">
import { computed } from "vue";
import LaySearch from "../../lay-search/index.vue";
import LayNotice from "../../lay-notice/index.vue";
import SidebarFullScreen from "./SidebarFullScreen.vue";
import { Button } from "@/components/ui/button";
import { useUserStoreHook } from "@/store/modules/user";
import { ChevronDown, LogOut } from "@lucide/vue";

const userStore = useUserStoreHook();
const displayName = computed(() => userStore.nickname || userStore.username || "用户");

function logout() {
  userStore.logOut();
}
</script>

<template>
  <div class="flex h-12 shrink-0 items-center justify-end gap-1 px-2 text-foreground">
    <LaySearch id="header-search" />
    <SidebarFullScreen />
    <LayNotice id="header-notice" />
    <details class="relative">
      <summary
        class="navbar-bg-hover flex h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        :aria-label="`用户菜单：${displayName}`"
      >
        <img
          v-if="userStore.avatar"
          :src="userStore.avatar"
          alt=""
          class="size-7 rounded-full object-cover"
        />
        <span v-else class="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium" aria-hidden="true">
          {{ displayName.slice(0, 1).toUpperCase() }}
        </span>
        <span class="hidden max-w-32 truncate sm:inline">{{ displayName }}</span>
        <ChevronDown class="size-3 text-muted-foreground" aria-hidden="true" />
      </summary>
      <div class="absolute right-0 z-50 mt-2 w-44 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg">
        <p class="truncate px-2 py-1 text-xs text-muted-foreground">{{ userStore.username }}</p>
        <div class="my-1 border-t border-border" />
        <Button type="button" variant="ghost" size="sm" class="w-full justify-start" @click="logout">
          <LogOut class="mr-2 size-4" aria-hidden="true" />
          退出系统
        </Button>
      </div>
    </details>
  </div>
</template>
