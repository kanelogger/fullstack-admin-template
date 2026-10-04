<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeftOpen } from "@lucide/vue";

defineProps<{ isActive?: boolean }>();
const emit = defineEmits<{ (event: "toggleClick"): void }>();
</script>

<template>
  <div class="mt-auto border-t border-border p-2">
    <Button
      type="button"
      variant="ghost"
      size="sm"
      class="w-full justify-start text-foreground hover:bg-accent"
      :aria-label="isActive ? '折叠侧边栏' : '展开侧边栏'"
      @click="emit('toggleClick')"
    >
      <PanelLeftClose v-if="isActive" class="mr-2 size-4" aria-hidden="true" />
      <PanelLeftOpen v-else class="mr-2 size-4" aria-hidden="true" />
      <span>收起导航</span>
    </Button>
  </div>
</template>
