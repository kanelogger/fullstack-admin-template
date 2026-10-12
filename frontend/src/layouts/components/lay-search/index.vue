<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Search } from "@lucide/vue";

const show = ref(false);
const mounted = ref(false);
const loadError = ref(false);
const loadAttempt = ref(0);

const SearchModal = defineAsyncComponent({
  loader: () => import("./components/SearchModal.vue"),
  onError(_error, _retry, fail) {
    loadError.value = true;
    mounted.value = false;
    show.value = false;
    fail();
  }
});

function openSearch() {
  loadError.value = false;
  if (!mounted.value) {
    loadAttempt.value += 1;
    mounted.value = true;
  }
  show.value = true;
}
</script>

<template>
  <div>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      class="search-container navbar-bg-hover"
      aria-label="搜索菜单"
      :title="loadError ? '搜索未能打开，请再试一次' : '搜索菜单'"
      @click="openSearch"
    >
      <Search class="size-4" aria-hidden="true" />
    </Button>
    <p v-if="loadError" role="alert" class="sr-only">搜索未能打开，请再试一次。</p>
    <SearchModal v-if="mounted && !loadError" :key="loadAttempt" v-model:value="show" />
  </div>
</template>
