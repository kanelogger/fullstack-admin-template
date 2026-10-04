<script setup lang="ts">
import { ref } from "vue";
import { Button } from "@/components/ui/button";
import { Search } from "@lucide/vue";
import SearchModal from "./components/SearchModal.vue";

const show = ref(false);
</script>

<template>
  <div>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="search-container navbar-bg-hover"
      aria-label="搜索菜单"
      title="搜索菜单"
      @click="show = true"
    >
      <Search class="size-4" aria-hidden="true" />
    </Button>
    <SearchModal v-model:value="show" />
  </div>
</template>
