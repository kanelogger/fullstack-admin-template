<script setup lang="ts">
import Toaster from "@/components/ui/toast/Toaster.vue";

defineOptions({ name: "App" });
</script>

<template>
  <router-view />
  <Toaster />
</template>
