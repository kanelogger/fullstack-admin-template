<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Menu } from "@lucide/vue";

defineProps<{ isActive?: boolean }>();
const emit = defineEmits<{ (event: "toggleClick"): void }>();
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    size="icon"
    class="navbar-bg-hover shrink-0"
    :aria-label="isActive ? '关闭导航菜单' : '打开导航菜单'"
    @click="emit('toggleClick')"
  >
    <Menu class="size-4" aria-hidden="true" />
  </Button>
</template>
