<script setup lang="ts">
import { computed } from "vue";
import type { menuType } from "@/layouts/types";

const props = defineProps<{ to: menuType }>();
const href = computed(() => {
  const value = String(props.to.name ?? props.to.path ?? "");
  return /^https?:\/\//i.test(value) ? value : "";
});
</script>

<template>
  <a v-if="href" :href="href" target="_blank" rel="noopener noreferrer"><slot /></a>
  <RouterLink v-else :to="to.redirect || to.path || '/'"><slot /></RouterLink>
</template>
