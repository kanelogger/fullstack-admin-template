<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

defineOptions({
  name: "SystemPlaceholder"
});

const route = useRoute();
const title = computed(() => String(route.meta?.title || "功能模块"));
</script>

<template>
  <main class="p-4 md:p-6">
    <Card class="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{{ title }}</CardTitle>
        <CardDescription>该模块尚未迁移，当前应用路由不会加载此占位页。</CardDescription>
      </CardHeader>
      <CardContent class="text-sm text-muted-foreground">可在后续模块切片中实现。</CardContent>
    </Card>
  </main>
</template>
