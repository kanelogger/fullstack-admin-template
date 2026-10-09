<script setup lang="ts">
import { computed } from "vue";
import LaySearch from "../../lay-search/index.vue";
import LayNotice from "../../lay-notice/index.vue";
import SidebarFullScreen from "./SidebarFullScreen.vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuItem
} from "@/components/ui/dropdown-menu";
import { useSessionStoreHook } from "@/stores/modules/session";
import { message } from "@/utils/message";
import { ChevronDown, LogOut } from "@lucide/vue";

const userStore = useSessionStoreHook();
const displayName = computed(() => userStore.nickname || userStore.username || "用户");

async function logout() {
  const result = await userStore.logOut();
  if (!result.serverSessionRevoked) {
    message("本机已退出，但服务端未确认撤销会话；请检查网络后重新登录。", {
      type: "warning"
    });
  }
}
</script>

<template>
  <div class="flex h-14 shrink-0 items-center justify-end gap-1 px-3 text-foreground">
    <LaySearch id="header-search" />
    <SidebarFullScreen />
    <LayNotice id="header-notice" />
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          class="navbar-bg-hover flex h-10 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
          :aria-label="`用户菜单：${displayName}`"
        >
          <img
            v-if="userStore.avatar"
            :src="userStore.avatar"
            alt=""
            class="size-7 rounded-full object-cover"
          />
          <span
            v-else
            class="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium"
            aria-hidden="true"
          >
            {{ displayName.slice(0, 1).toUpperCase() }}
          </span>
          <span class="hidden max-w-32 truncate sm:inline">{{ displayName }}</span>
          <ChevronDown class="size-3 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-44">
        <DropdownMenuLabel class="truncate">{{ userStore.username }}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem @select="logout">
            <LogOut aria-hidden="true" />退出系统
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
