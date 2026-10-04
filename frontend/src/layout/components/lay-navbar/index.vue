<script setup lang="ts">
import { computed } from "vue";
import { useAppStoreHook } from "@/store/modules/app";
import SidebarHeaderActions from "../lay-sidebar/components/SidebarHeaderActions.vue";
import SidebarBreadCrumb from "../lay-sidebar/components/SidebarBreadCrumb.vue";
import SidebarTopCollapse from "../lay-sidebar/components/SidebarTopCollapse.vue";
import NavMix from "../lay-sidebar/NavMix.vue";

const appStore = useAppStoreHook();
const layout = computed(() => appStore.layout);
const isMobile = computed(() => appStore.device === "mobile");
const sidebarOpened = computed(() => appStore.sidebar.opened);

function toggleSidebar() {
  void appStore.toggleSideBar();
}
</script>

<template>
  <header class="navbar flex h-12 min-w-0 items-center gap-3 border-b border-border bg-background px-2 text-foreground shadow-sm">
    <SidebarTopCollapse
      v-if="isMobile"
      :is-active="sidebarOpened"
      @toggle-click="toggleSidebar"
    />
    <SidebarBreadCrumb
      v-if="layout !== 'mix' && !isMobile"
      class="min-w-0 flex-1 pl-2"
    />
    <NavMix v-if="layout === 'mix'" class="min-w-0 flex-1" />
    <SidebarHeaderActions v-if="layout === 'vertical'" class="ml-auto" />
  </header>
</template>
