<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { onClickOutside } from "@vueuse/core";
import { useRoute, useRouter } from "vue-router";
import { RefreshCw, X, MoreHorizontal } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/config";
import { routerArrays, type RouteConfigs } from "@/layouts/types";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import { useTabsStoreHook } from "@/stores/modules/tabs";
import { handleAliveRoute } from "@/router/utils";
import NProgress from "@/utils/progress";

type TagAction = "refresh" | "current" | "left" | "right" | "other" | "all";

const route = useRoute();
const router = useRouter();
const tagStore = useTabsStoreHook();
const permissionStore = usePermissionStoreHook();
const container = ref<HTMLElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const contextTag = ref<RouteConfigs | null>(null);
const contextPosition = ref({ x: 0, y: 0 });
const contextOpen = ref(false);
const dropdownOpen = ref(false);
const hideTags = getConfig().HideTabs ?? false;
const tags = computed(() => tagStore.multiTags as RouteConfigs[]);
const fixedTags = computed(() => [
  ...routerArrays,
  ...permissionStore.flatteningRoutes.filter(item => item?.meta?.fixedTag)
]);
const activeTag = computed(() =>
  tags.value.find(item => isCurrent(item, route.path, route.query, route.params))
);
const actions: Array<{ action: TagAction; label: string }> = [
  { action: "refresh", label: "重新加载当前页" },
  { action: "current", label: "关闭当前标签页" },
  { action: "left", label: "关闭左侧标签页" },
  { action: "right", label: "关闭右侧标签页" },
  { action: "other", label: "关闭其他标签页" },
  { action: "all", label: "关闭全部标签页" }
];

watch(
  () => route.fullPath,
  () => {
    const leaf = route.matched.at(-1);
    const meta = { ...route.meta, ...(leaf?.meta ?? {}) };
    if (typeof meta.title === "string") {
      tagStore.handleTags("push", {
        path: route.path,
        name: String(route.name ?? leaf?.name ?? ""),
        query: Object.keys(route.query).length ? { ...route.query } : undefined,
        params: Object.keys(route.params).length ? { ...route.params } : undefined,
        meta
      });
    }
  },
  { immediate: true }
);

function isCurrent(item: RouteConfigs, path: string, query: object, params: object) {
  return item.path === path &&
    JSON.stringify(item.query ?? {}) === JSON.stringify(query ?? {}) &&
    JSON.stringify(item.params ?? {}) === JSON.stringify(params ?? {});
}

function navigateTo(item?: RouteConfigs | null) {
  if (!item?.path) return;
  if (item.name) {
    void router.push({
      name: item.name,
      query: item.query as any,
      params: item.params as any
    });
  } else {
    void router.push({ path: item.path, query: item.query as any });
  }
}

async function perform(action: TagAction, target: RouteConfigs | null = activeTag.value ?? null) {
  contextOpen.value = false;
  dropdownOpen.value = false;
  if (action === "refresh") {
    NProgress.start();
    const current = route;
    await router.replace({ path: `/redirect${current.fullPath}` });
    handleAliveRoute(current as any, "refresh");
    NProgress.done();
    return;
  }
  if (action === "all") {
    const firstFixed = fixedTags.value[0] ?? tags.value[0];
    const keep = fixedTags.value.length ? fixedTags.value : firstFixed ? [firstFixed] : [];
    tagStore.handleTags("equal", keep);
    navigateTo(keep.at(-1));
    handleAliveRoute(route as any);
    return;
  }

  if (!target) return;
  const targetIndex = tags.value.findIndex(item => isCurrent(item, target.path ?? "", target.query ?? {}, target.params ?? {}));
  if (targetIndex < 0 || target.meta?.fixedTag) return;
  const protectedCount = Math.min(fixedTags.value.length, tags.value.length);
  let nextTags = [...tags.value];

  if (action === "current") {
    nextTags.splice(targetIndex, 1);
  } else if (action === "left") {
    if (targetIndex > protectedCount) nextTags.splice(protectedCount, targetIndex - protectedCount);
  } else if (action === "right") {
    nextTags.splice(targetIndex + 1);
  } else if (action === "other") {
    nextTags = [
      ...fixedTags.value,
      target
    ].filter((item, index, all) =>
      all.findIndex(candidate => isCurrent(candidate, item.path ?? "", item.query ?? {}, item.params ?? {})) === index
    );
  }

  tagStore.handleTags("equal", nextTags);
  const targetStillExists = nextTags.some(item => isCurrent(item, route.path, route.query, route.params));
  if ((action === "current" && isCurrent(target, route.path, route.query, route.params)) || !targetStillExists) {
    navigateTo(nextTags.at(-1) ?? fixedTags.value.at(-1));
  }
  handleAliveRoute(route as any);
}

function openContext(item: RouteConfigs, event: MouseEvent) {
  contextTag.value = item;
  contextPosition.value = {
    x: Math.min(event.clientX, window.innerWidth - 220),
    y: Math.min(event.clientY, window.innerHeight - 270)
  };
  contextOpen.value = true;
}

function isActionDisabled(action: TagAction, item: RouteConfigs | null) {
  if (action === "refresh") return !item || !isCurrent(item, route.path, route.query, route.params);
  if (action === "all") return tags.value.length <= fixedTags.value.length;
  if (!item || item.meta?.fixedTag) return true;
  const index = tags.value.findIndex(tag => isCurrent(tag, item.path ?? "", item.query ?? {}, item.params ?? {}));
  if (index < 0) return true;
  if (action === "current") return tags.value.length <= fixedTags.value.length;
  if (action === "left") return index <= fixedTags.value.length;
  if (action === "right") return index >= tags.value.length - 1;
  if (action === "other") return tags.value.length <= fixedTags.value.length + 1;
  return false;
}

function runAction(action: TagAction, item: RouteConfigs | null) {
  if (!isActionDisabled(action, item)) void perform(action, item);
}

function closeContext() {
  contextOpen.value = false;
}

onClickOutside(menu, closeContext);
</script>

<template>
  <div v-if="!hideTags" ref="container" class="tags-view flex h-9 min-w-0 items-center gap-1 border-b border-border bg-background px-2 text-foreground">
    <nav class="min-w-0 flex-1 overflow-x-auto" aria-label="已打开页面">
      <ul class="flex min-w-max items-center gap-1 p-0">
        <li
          v-for="item in tags"
          :key="`${item.path}:${JSON.stringify(item.query ?? {})}:${JSON.stringify(item.params ?? {})}`"
          class="group list-none"
        >
          <div
            class="flex h-7 items-center rounded-md border border-transparent transition-colors"
            :class="activeTag && isCurrent(item, activeTag.path ?? '', activeTag.query ?? {}, activeTag.params ?? {}) ? 'border-border bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'"
            @contextmenu.prevent="openContext(item, $event)"
          >
            <button
              type="button"
              class="max-w-48 truncate px-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-current="activeTag && isCurrent(item, activeTag.path ?? '', activeTag.query ?? {}, activeTag.params ?? {}) ? 'page' : undefined"
              @click="navigateTo(item)"
            >
              {{ item.meta?.title || item.path }}
            </button>
            <Button
              v-if="!item.meta?.fixedTag && tags.length > fixedTags.length"
              type="button"
              variant="ghost"
              size="icon"
              class="mr-1 size-5 opacity-60 hover:opacity-100"
              :aria-label="`关闭${item.meta?.title || '页面'}`"
              @click="perform('current', item)"
            >
              <X class="size-3" aria-hidden="true" />
            </Button>
          </div>
        </li>
      </ul>
    </nav>

    <details class="relative shrink-0" :open="dropdownOpen" @toggle="dropdownOpen = ($event.target as HTMLDetailsElement).open">
      <summary class="grid size-7 cursor-pointer list-none place-items-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden" aria-label="标签页操作">
        <MoreHorizontal class="size-4" aria-hidden="true" />
      </summary>
      <div class="absolute right-0 z-40 mt-1 w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        <Button
          v-for="item in actions"
          :key="item.action"
          type="button"
          variant="ghost"
          size="sm"
          class="w-full justify-start"
          :disabled="isActionDisabled(item.action, activeTag ?? null)"
          @click="runAction(item.action, activeTag ?? null)"
        >
          <RefreshCw v-if="item.action === 'refresh'" class="mr-2 size-3.5" aria-hidden="true" />
          {{ item.label }}
        </Button>
      </div>
    </details>

    <div
      v-if="contextOpen && contextTag"
      ref="menu"
      class="fixed z-[1200] w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl"
      :style="{ left: contextPosition.x + 'px', top: contextPosition.y + 'px' }"
      role="menu"
      aria-label="标签页操作"
    >
      <Button
        v-for="item in actions"
        :key="item.action"
        type="button"
        variant="ghost"
        size="sm"
        class="w-full justify-start"
        role="menuitem"
        :disabled="isActionDisabled(item.action, contextTag)"
        @click="runAction(item.action, contextTag)"
      >
        <RefreshCw v-if="item.action === 'refresh'" class="mr-2 size-3.5" aria-hidden="true" />
        {{ item.label }}
      </Button>
    </div>
  </div>
</template>
