<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { match } from "pinyin-pro";
import Sortable from "sortablejs";
import { useEventListener } from "@vueuse/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getConfig } from "@/config";
import { initRouter } from "@/router/utils";
import { usePermissionStoreHook } from "@/stores/modules/permission";
import { Star, X } from "@lucide/vue";
import SearchFooter from "./SearchFooter.vue";

type MenuOption = {
  path: string;
  name?: string;
  type?: "history" | "collect";
  meta?: { title?: string; icon?: string };
};

const props = defineProps<{ value: boolean }>();
const emit = defineEmits<{ (event: "update:value", value: boolean): void }>();
const router = useRouter();
const permissionStore = usePermissionStoreHook();
const dialog = ref<HTMLDialogElement | null>(null);
const favoritesList = ref<HTMLElement | null>(null);
const keyword = ref("");
const selectedIndex = ref(0);
const history = ref<MenuOption[]>([]);
const favorites = ref<MenuOption[]>([]);
const menuLoading = ref(false);
const menuError = ref("");
let sortable: Sortable | undefined;

const historyKey = "menu-search-history";
const favoritesKey = "menu-search-collect";
const historyLimit = Number(getConfig().MenuSearchHistory ?? 6);

const menuOptions = computed<MenuOption[]>(() => {
  const result: MenuOption[] = [];
  const visit = (items: any[]) => {
    for (const item of items) {
      if (item.meta?.title && item.meta?.showLink !== false) {
        result.push({
          path: String(item.path ?? ""),
          name: item.name,
          meta: { title: String(item.meta.title), icon: item.meta.icon }
        });
      }
      if (item.children?.length) visit(item.children);
    }
  };
  visit(permissionStore.wholeMenus);
  return result.filter(item => item.path);
});

const searchResults = computed(() => {
  const term = keyword.value.trim().toLocaleLowerCase();
  if (!term) return [];
  return menuOptions.value.filter(item => {
    const title = item.meta?.title?.toLocaleLowerCase() ?? "";
    return title.includes(term) || Boolean(match(title, term)?.length);
  });
});

const visibleOptions = computed<MenuOption[]>(() => {
  if (keyword.value.trim()) return searchResults.value;
  return [...history.value, ...favorites.value];
});

watch(
  () => props.value,
  async open => {
    if (open) {
      loadSavedItems();
      await nextTick();
      if (dialog.value && !dialog.value.open) dialog.value.showModal();
      dialog.value?.querySelector<HTMLInputElement>("input")?.focus();
    } else if (dialog.value?.open) {
      dialog.value.close();
    }
  },
  { immediate: true }
);

watch(
  () => favorites.value.map(item => item.path).join("|"),
  async () => {
    await nextTick();
    sortable?.destroy();
    sortable = undefined;
    if (favoritesList.value && favorites.value.length > 1) {
      sortable = Sortable.create(favoritesList.value, {
        animation: 140,
        draggable: "[data-favorite-path]",
        onEnd: ({ oldIndex, newIndex }) => {
          if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
          const reordered = [...favorites.value];
          const [item] = reordered.splice(oldIndex, 1);
          if (item) reordered.splice(newIndex, 0, item);
          favorites.value = reordered;
          persistItems(favoritesKey, favorites.value);
        }
      });
    }
  }
);

useEventListener(dialog, "keydown", (event: KeyboardEvent) => {
  if (!props.value) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (visibleOptions.value.length === 0) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    selectedIndex.value =
      (selectedIndex.value + direction + visibleOptions.value.length) %
      visibleOptions.value.length;
  } else if (event.key === "Enter") {
    event.preventDefault();
    const selected = visibleOptions.value[selectedIndex.value];
    if (selected) openOption(selected);
  } else if (event.key === "Escape") {
    close();
  }
});

useEventListener(dialog, "click", (event: MouseEvent) => {
  if (!props.value || event.target !== dialog.value || !dialog.value) return;
  const rect = dialog.value.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  ) {
    close();
  }
});

function readSavedItems(key: string): MenuOption[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is MenuOption =>
            typeof item?.path === "string" &&
            typeof item?.meta?.title === "string"
        )
      : [];
  } catch {
    return [];
  }
}

function persistItems(key: string, items: MenuOption[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Search still works if browser storage is unavailable.
  }
}

function loadSavedItems() {
  history.value = readSavedItems(historyKey);
  favorites.value = readSavedItems(favoritesKey);
  selectedIndex.value = 0;
}

function close() {
  emit("update:value", false);
  keyword.value = "";
  selectedIndex.value = 0;
}

function addHistory(item: MenuOption) {
  if (favorites.value.some(favorite => favorite.path === item.path)) return;
  history.value = [
    { path: item.path, name: item.name, meta: item.meta, type: "history" as const },
    ...history.value.filter(entry => entry.path !== item.path)
  ].slice(0, historyLimit);
  persistItems(historyKey, history.value);
}

function openOption(item: MenuOption) {
  if (keyword.value.trim() || !item.type) addHistory(item);
  else if (item.type === "history") {
    history.value = [item, ...history.value.filter(entry => entry.path !== item.path)];
    persistItems(historyKey, history.value);
  }
  close();
  void router.push(item.path);
}

function collect(item: MenuOption) {
  history.value = history.value.filter(entry => entry.path !== item.path);
  favorites.value = [
    { ...item, type: "collect" },
    ...favorites.value.filter(entry => entry.path !== item.path)
  ];
  persistItems(historyKey, history.value);
  persistItems(favoritesKey, favorites.value);
}

function removeItem(item: MenuOption) {
  if (item.type === "collect") {
    favorites.value = favorites.value.filter(entry => entry.path !== item.path);
    persistItems(favoritesKey, favorites.value);
  } else {
    history.value = history.value.filter(entry => entry.path !== item.path);
    persistItems(historyKey, history.value);
  }
}

async function retryMenus() {
  menuLoading.value = true;
  menuError.value = "";
  try {
    await initRouter();
    if (!permissionStore.wholeMenus.length) {
      menuError.value = "账号没有已授权的可搜索菜单。";
    }
  } catch (error) {
    menuError.value = error instanceof Error ? error.message : "菜单加载失败。";
  } finally {
    menuLoading.value = false;
  }
}

function handleInput() {
  selectedIndex.value = 0;
}

onBeforeUnmount(() => sortable?.destroy());
</script>

<template>
  <dialog
    ref="dialog"
    class="w-[min(42rem,92vw)] max-w-none rounded-xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/50"
    aria-label="搜索菜单"
    @cancel.prevent="close"
    @close="emit('update:value', false)"
  >
    <div class="flex items-center gap-3 border-b border-border p-4">
      <span aria-hidden="true" class="text-muted-foreground">⌕</span>
      <Input
        ref="input"
        v-model="keyword"
        type="search"
        class="h-11 border-0 px-0 shadow-none focus-visible:ring-0"
        placeholder="搜索菜单（支持拼音）"
        aria-label="搜索菜单"
        @input="handleInput"
      />
      <kbd class="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">ESC</kbd>
    </div>

    <div class="max-h-[min(62vh,34rem)] overflow-y-auto p-4">
      <div v-if="menuLoading" role="status" class="space-y-3">
        <div class="h-11 animate-pulse rounded-md bg-muted" />
        <p class="text-sm text-muted-foreground">正在加载菜单…</p>
      </div>
      <div v-else-if="menuError" role="alert" class="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <p class="text-sm text-destructive">{{ menuError }}</p>
        <Button type="button" size="sm" variant="outline" @click="retryMenus">重试</Button>
      </div>
      <div v-else-if="menuOptions.length === 0" role="status" class="space-y-3 rounded-md border border-border p-4 text-sm text-muted-foreground">
        <p>菜单尚未加载或当前账号没有可用菜单。</p>
        <Button type="button" size="sm" variant="outline" @click="retryMenus">重新加载菜单</Button>
      </div>
      <div v-else-if="keyword.trim() && searchResults.length === 0" role="status" class="py-10 text-center text-sm text-muted-foreground">
        没有匹配的菜单，试试菜单名称或拼音。
      </div>
      <div v-else-if="!keyword.trim() && visibleOptions.length === 0" role="status" class="py-10 text-center text-sm text-muted-foreground">
        暂无搜索历史或收藏；输入关键词查找菜单。
      </div>
      <template v-else>
        <section v-if="keyword.trim()" aria-label="搜索结果">
          <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">搜索结果</h2>
          <ul class="space-y-1">
            <li v-for="(item, index) in searchResults" :key="item.path">
              <button
                type="button"
                class="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                :class="selectedIndex === index ? 'bg-accent text-accent-foreground' : ''"
                @mouseenter="selectedIndex = index"
                @click="openOption(item)"
              >
                <span class="min-w-0 flex-1 truncate">{{ item.meta?.title }}</span>
                <kbd class="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">↵</kbd>
              </button>
            </li>
          </ul>
        </section>
        <section v-else-if="history.length" aria-label="搜索历史">
          <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">搜索历史</h2>
          <ul class="space-y-1">
            <li v-for="(item, index) in history" :key="item.path">
              <div
                class="flex min-h-11 items-center gap-1 rounded-md pr-1 text-sm transition-colors hover:bg-accent"
                :class="selectedIndex === index ? 'bg-accent text-accent-foreground' : ''"
                @mouseenter="selectedIndex = index"
              >
                <button type="button" class="min-w-0 flex-1 truncate px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="openOption(item)">
                  {{ item.meta?.title }}
                </button>
                <Button type="button" variant="ghost" size="icon" class="size-8" aria-label="收藏菜单" @click="collect(item)">
                  <Star class="size-4" aria-hidden="true" />
                </Button>
                <Button type="button" variant="ghost" size="icon" class="size-8" aria-label="删除搜索记录" @click="removeItem(item)">
                  <X class="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          </ul>
        </section>
        <section v-if="!keyword.trim() && favorites.length" aria-label="收藏菜单" class="mt-5">
          <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">收藏</h2>
          <ul ref="favoritesList" class="space-y-1">
            <li v-for="(item, index) in favorites" :key="item.path" :data-favorite-path="item.path">
              <div
                class="flex min-h-11 items-center gap-1 rounded-md pr-1 text-sm transition-colors hover:bg-accent"
                :class="selectedIndex === history.length + index ? 'bg-accent text-accent-foreground' : ''"
                @mouseenter="selectedIndex = history.length + index"
              >
                <button type="button" class="min-w-0 flex-1 truncate px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" @click="openOption(item)">
                  {{ item.meta?.title }}
                </button>
                <Button type="button" variant="ghost" size="icon" class="size-8" aria-label="取消收藏" @click="removeItem(item)">
                  <X class="size-4" aria-hidden="true" />
                </Button>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </div>
    <footer class="border-t border-border px-4 py-3">
      <SearchFooter :total="keyword.trim() ? searchResults.length : visibleOptions.length" />
    </footer>
  </dialog>
</template>
