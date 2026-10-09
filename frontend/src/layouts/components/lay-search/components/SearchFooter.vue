<script setup lang="ts">
defineProps<{ total?: number }>();
</script>

<template>
  <div class="flex items-center gap-3 text-xs text-muted-foreground">
    <span><kbd class="rounded border border-border px-1">↵</kbd> 确认</span>
    <span
      ><kbd class="rounded border border-border px-1">↑</kbd>
      <kbd class="rounded border border-border px-1">↓</kbd> 切换</span
    >
    <span><kbd class="rounded border border-border px-1">ESC</kbd> 关闭</span>
    <span v-if="total" class="ml-auto">共 {{ total }} 项</span>
  </div>
</template>
