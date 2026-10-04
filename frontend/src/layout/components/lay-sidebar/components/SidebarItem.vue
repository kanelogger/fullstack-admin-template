<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { resolveMenuIcon } from "@/features/menus/menu-icons";
import type { menuType } from "@/layout/types";

defineOptions({ name: "SidebarItem" });

const props = defineProps<{
  item: menuType;
  basePath?: string;
  collapsed?: boolean;
  horizontal?: boolean;
}>();

const route = useRoute();
const children = computed(() => props.item.children ?? []);
const singleVisibleChild = computed(
  () => children.value.length === 1 && !props.item.meta?.showParent
);
const displayItem = computed(() =>
  singleVisibleChild.value ? children.value[0] : props.item
);
const itemPath = computed(() => resolvePath(props.basePath ?? "", displayItem.value.path ?? ""));
const active = computed(() => {
  const target = String(route.meta.activePath ?? route.path);
  return target === itemPath.value || target.startsWith(`${itemPath.value}/`);
});
const icon = computed(() =>
  displayItem.value.meta?.icon || props.item.meta?.icon
    ? resolveMenuIcon(displayItem.value.meta?.icon || props.item.meta?.icon)
    : undefined
);
const externalUrl = computed(() => {
  const value = displayItem.value.name ?? itemPath.value;
  return /^https?:\/\//i.test(value) ? value : "";
});

function resolvePath(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("/")) return path;
  const prefix = base.replace(/\/$/, "");
  return `${prefix}/${path}`.replace(/\/+/g, "/") || "/";
}
</script>

<template>
  <li class="min-w-0 list-none">
    <details
      v-if="children.length && !singleVisibleChild"
      class="group"
      :open="active"
      :aria-label="item.meta?.title"
    >
      <summary
        class="flex min-h-10 cursor-pointer list-none items-center gap-3 rounded-md px-3 text-sm text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        :class="[
          active ? 'bg-accent text-accent-foreground' : '',
          collapsed ? 'justify-center px-2' : '',
          horizontal ? 'whitespace-nowrap' : ''
        ]"
        :title="collapsed ? item.meta?.title : undefined"
      >
        <component v-if="icon" :is="icon" class="size-4 shrink-0" aria-hidden="true" />
        <span v-if="!collapsed" class="min-w-0 flex-1 truncate">{{ item.meta?.title }}</span>
        <span v-if="!collapsed" class="text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true">›</span>
      </summary>
      <ul
        class="ml-4 mt-1 space-y-1 border-l border-border pl-2"
        :class="horizontal ? 'absolute z-20 min-w-52 rounded-md border bg-popover p-2 shadow-md' : ''"
      >
        <SidebarItem
          v-for="child in children"
          :key="`${itemPath}/${child.path}`"
          :item="child"
          :base-path="itemPath"
          :collapsed="false"
          :horizontal="horizontal"
        />
      </ul>
    </details>
    <a
      v-else-if="externalUrl"
      :href="externalUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      :title="collapsed ? displayItem.meta?.title : undefined"
    >
      <component v-if="icon" :is="icon" class="size-4 shrink-0" aria-hidden="true" />
      <span v-if="!collapsed" class="truncate">{{ displayItem.meta?.title }}</span>
    </a>
    <RouterLink
      v-else
      :to="displayItem.redirect || itemPath"
      class="flex min-h-10 items-center gap-3 rounded-md px-3 text-sm text-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      :class="[
        active ? 'bg-accent font-medium text-accent-foreground' : '',
        collapsed ? 'justify-center px-2' : '',
        horizontal ? 'whitespace-nowrap' : ''
      ]"
      :title="collapsed ? displayItem.meta?.title : undefined"
    >
      <component v-if="icon" :is="icon" class="size-4 shrink-0" aria-hidden="true" />
      <span v-if="!collapsed" class="min-w-0 truncate">{{ displayItem.meta?.title }}</span>
      <span v-if="!collapsed && displayItem.meta?.extraIcon" class="ml-auto text-muted-foreground">{{ displayItem.meta.extraIcon }}</span>
    </RouterLink>
  </li>
</template>
