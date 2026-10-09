<script setup lang="ts">
import ConfirmationDialog from "@/components/ConfirmationDialog.vue";
import { Toaster } from "@/components/ui/sonner";
import "vue-sonner/style.css";

defineOptions({ name: "App" });
</script>

<template>
  <router-view />
  <Toaster position="top-right" :visible-toasts="4" />
  <ConfirmationDialog />
</template>
