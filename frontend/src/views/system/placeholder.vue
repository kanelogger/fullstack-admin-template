<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

defineOptions({
  name: "SystemPlaceholder"
});

const route = useRoute();
const title = computed(() => String(route.meta?.title || "功能模块"));
</script>

<template>
  <div class="p-6">
    <el-empty
      :description="`${title}将在后续 Sprint 中实现`"
      :image-size="120"
    />
  </div>
</template>
