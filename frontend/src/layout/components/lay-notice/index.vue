<script setup lang="ts">
import { onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useNotificationStoreHook } from "@/store/modules/notification";
import { Bell } from "@lucide/vue";

const router = useRouter();
const notificationStore = useNotificationStoreHook();
const { unreadMessageCount, loadError } = storeToRefs(notificationStore);
const loading = ref(true);
const panel = ref<HTMLDetailsElement | null>(null);

async function refreshCount() {
  loading.value = true;
  await notificationStore.refreshUnreadMessageCount();
  loading.value = false;
}

function openMessages() {
  panel.value?.removeAttribute("open");
  void router.push("/operation/messages");
}

onMounted(() => void refreshCount());
</script>

<template>
  <details ref="panel" class="relative h-12">
    <summary
      class="dropdown-badge navbar-bg-hover flex h-12 cursor-pointer list-none items-center justify-center rounded-md px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      :aria-label="'消息中心，' + unreadMessageCount + ' 条未读'"
    >
      <span class="relative grid size-6 place-items-center" aria-hidden="true">
        <Bell class="size-4" />
        <Badge
          v-if="unreadMessageCount > 0"
          class="absolute -right-3 -top-1 min-w-5 justify-center px-1 py-0 text-[10px]"
          :aria-label="unreadMessageCount + ' 条未读'"
        >
          {{ unreadMessageCount > 99 ? "99+" : unreadMessageCount }}
        </Badge>
      </span>
    </summary>
    <section class="absolute right-0 z-50 mt-2 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg" aria-label="消息通知">
      <div class="mb-3 flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">消息通知</h2>
        <span class="text-xs text-muted-foreground">{{ unreadMessageCount }} 条未读</span>
      </div>
      <p v-if="loading" class="py-5 text-center text-sm text-muted-foreground" role="status">
        正在加载未读消息…
      </p>
      <div v-else-if="loadError" class="space-y-3" role="alert">
        <p class="text-sm text-destructive">未读消息加载失败：{{ loadError }}</p>
        <Button type="button" variant="outline" size="sm" class="w-full" @click="refreshCount">
          重试
        </Button>
      </div>
      <p v-else-if="unreadMessageCount === 0" class="py-5 text-center text-sm text-muted-foreground" role="status">
        暂无未读消息
      </p>
      <Button v-else type="button" variant="outline" size="sm" class="w-full" @click="openMessages">
        打开消息中心
      </Button>
      <Button
        v-if="!loading && !loadError && unreadMessageCount === 0"
        type="button"
        variant="ghost"
        size="sm"
        class="mt-2 w-full"
        @click="openMessages"
      >
        查看消息中心
      </Button>
    </section>
  </details>
</template>
