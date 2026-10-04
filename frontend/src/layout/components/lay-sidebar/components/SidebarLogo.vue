<script setup lang="ts">
import { getConfig } from "@/config";
import { getTopMenu } from "@/router/utils";

defineProps<{ collapse?: boolean }>();
const title = getConfig().Title || "Admin";
const homePath = getTopMenu()?.path ?? "/welcome";
</script>

<template>
  <div class="sidebar-logo-container flex h-12 shrink-0 items-center overflow-hidden border-b border-border px-3">
    <RouterLink
      :to="homePath"
      :title="title"
      class="flex min-w-0 items-center gap-3 font-semibold text-foreground"
    >
      <span class="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-sm text-primary-foreground" aria-hidden="true">
        {{ title.slice(0, 1).toUpperCase() }}
      </span>
      <span v-if="!collapse" class="truncate">{{ title }}</span>
    </RouterLink>
  </div>
</template>
