<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const breadcrumbs = computed(() =>
  route.matched.filter(record => {
    const title = record.meta.title;
    return typeof title === "string" && title.length > 0 && title !== "Layout";
  })
);
</script>

<template>
  <nav aria-label="面包屑" class="min-w-0">
    <ol class="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <li v-for="(record, index) in breadcrumbs" :key="record.path" class="flex min-w-0 items-center gap-2">
        <span v-if="index > 0" aria-hidden="true" class="text-border">/</span>
        <RouterLink
          v-if="index < breadcrumbs.length - 1 && record.name"
          :to="{ name: record.name }"
          class="truncate hover:text-foreground hover:underline"
        >
          {{ record.meta.title }}
        </RouterLink>
        <span v-else class="truncate font-medium text-foreground" aria-current="page">
          {{ record.meta.title }}
        </span>
      </li>
    </ol>
  </nav>
</template>
