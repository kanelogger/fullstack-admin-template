<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ChevronLeft, ChevronRight } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import type { menuType } from "@/layouts/types";
import SidebarItem from "./components/SidebarItem.vue";

const props = defineProps<{
  items: menuType[];
  label: string;
}>();

const route = useRoute();
const navElement = ref<HTMLElement>();
const canScrollLeft = ref(false);
const canScrollRight = ref(false);
const leftButtonLabel = computed(() => `向左滚动${props.label}`);
const rightButtonLabel = computed(() => `向右滚动${props.label}`);

function updateScrollControls() {
  const nav = navElement.value;
  canScrollLeft.value = Boolean(nav && nav.scrollLeft > 1);
  canScrollRight.value = Boolean(nav && nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
}

function revealActiveItem() {
  const nav = navElement.value;
  const activeItem = nav?.querySelector<HTMLElement>(
    'a[aria-current="page"], a.router-link-exact-active, a.router-link-active'
  );
  if (!nav || !activeItem) {
    updateScrollControls();
    return;
  }

  const navBounds = nav.getBoundingClientRect();
  const itemBounds = activeItem.getBoundingClientRect();
  const edgeInset = 2;
  if (itemBounds.left < navBounds.left + edgeInset) {
    nav.scrollLeft -= navBounds.left + edgeInset - itemBounds.left;
  } else if (itemBounds.right > navBounds.right - edgeInset) {
    nav.scrollLeft += itemBounds.right - navBounds.right + edgeInset;
  }
  updateScrollControls();
}

function scrollMenu(direction: -1 | 1) {
  const nav = navElement.value;
  if (!nav) return;
  nav.scrollBy({ left: direction * Math.max(nav.clientWidth * 0.7, 160), behavior: "smooth" });
}

async function revealCurrentRoute() {
  await nextTick();
  updateScrollControls();
  await nextTick();
  revealActiveItem();
  await nextTick();
  revealActiveItem();
}

function handleWindowResize() {
  void revealCurrentRoute();
}

onMounted(() => {
  window.addEventListener("resize", handleWindowResize);
  void revealCurrentRoute();
});

watch(
  () => props.items.length,
  () => void revealCurrentRoute(),
  { flush: "post" }
);

watch(
  () => route.fullPath,
  () => void revealCurrentRoute(),
  { flush: "post" }
);

onBeforeUnmount(() => window.removeEventListener("resize", handleWindowResize));
</script>

<template>
  <div class="flex min-w-0 flex-1 items-center gap-1">
    <Button
      v-if="canScrollLeft"
      type="button"
      variant="ghost"
      size="icon"
      class="size-8 shrink-0"
      :aria-label="leftButtonLabel"
      @click="scrollMenu(-1)"
    >
      <ChevronLeft class="size-4" aria-hidden="true" />
    </Button>
    <nav
      ref="navElement"
      :aria-label="label"
      class="min-w-0 flex-1 overflow-x-auto overscroll-x-contain"
      @scroll.passive="updateScrollControls"
    >
      <ul v-if="items.length" class="horizontal-header-menu flex min-w-max items-center gap-1 px-2">
        <SidebarItem
          v-for="item in items"
          :key="item.path"
          :item="item"
          :base-path="''"
          horizontal
        />
      </ul>
      <p v-else class="px-4 text-sm text-muted-foreground" role="status">当前账号没有可用菜单。</p>
    </nav>
    <Button
      v-if="canScrollRight"
      type="button"
      variant="ghost"
      size="icon"
      class="size-8 shrink-0"
      :aria-label="rightButtonLabel"
      @click="scrollMenu(1)"
    >
      <ChevronRight class="size-4" aria-hidden="true" />
    </Button>
  </div>
</template>
