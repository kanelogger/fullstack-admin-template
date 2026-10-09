<script setup lang="ts">
import { computed } from "vue";
import { useFullscreen } from "@vueuse/core";
import { Button } from "@/components/ui/button";
import { Maximize, Minimize } from "@lucide/vue";

const { isFullscreen, toggle } = useFullscreen();
const title = computed(() => (isFullscreen.value ? "退出全屏" : "进入全屏"));
</script>

<template>
  <Button
    type="button"
    variant="ghost"
    size="icon"
    class="fullscreen-icon navbar-bg-hover"
    :aria-label="title"
    :title="title"
    @click="toggle"
  >
    <Minimize v-if="isFullscreen" class="size-4" aria-hidden="true" />
    <Maximize v-else class="size-4" aria-hidden="true" />
  </Button>
</template>
