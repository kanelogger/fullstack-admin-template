<script setup lang="ts">
import { computed } from "vue";
import { useRenderIcon } from "@/components/ReIcon/src/hooks";

const props = defineProps<{ extraIcon?: string }>();
const icon = computed(() => props.extraIcon ? useRenderIcon(props.extraIcon) : undefined);
</script>

<template>
  <component v-if="icon" :is="icon" class="ml-auto size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
</template>
