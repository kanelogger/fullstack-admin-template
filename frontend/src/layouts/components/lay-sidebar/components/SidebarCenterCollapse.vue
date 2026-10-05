<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { ChevronsLeft, ChevronsRight } from "@lucide/vue";

defineProps<{ isActive?: boolean }>();
const emit = defineEmits<{ (event: "toggleClick"): void }>();
</script>

<template>
  <Button
    type="button"
    variant="outline"
    size="icon"
    class="absolute right-0 top-1/2 z-10 size-7 translate-x-1/2 -translate-y-1/2 rounded-full bg-background shadow-sm"
    :aria-label="isActive ? '折叠侧边栏' : '展开侧边栏'"
    @click="emit('toggleClick')"
  >
    <ChevronsLeft v-if="isActive" class="size-4" aria-hidden="true" />
    <ChevronsRight v-else class="size-4" aria-hidden="true" />
  </Button>
</template>
