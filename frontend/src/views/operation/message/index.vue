<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { message } from "@/utils/message";
import {
  type MessageDetail,
  type MessageListItem
} from "@/contracts";
import {
  getMessage,
  getMessages,
  getUnreadMessageCount,
  markMessageRead,
  markMessagesRead
} from "@/features/messages/messages.service";
import { useNotificationStoreHook } from "@/store/modules/notification";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, ArrowRight, Inbox, LoaderCircle, Mail, MailOpen, RefreshCw, X } from "@lucide/vue";

defineOptions({ name: "OperationMessage" });

const notificationStore = useNotificationStoreHook();
const loading = ref(false);
const detailLoading = ref(false);
const detailOpen = ref(false);
const loadError = ref("");
const rows = ref<MessageListItem[]>([]);
const selectedIds = ref<string[]>([]);
const detail = ref<MessageDetail | null>(null);
const total = ref(0);

const query = reactive({
  title: "",
  messageType: "",
  readStatus: "",
  sentStartAt: "",
  sentEndAt: "",
  page: 1,
  pageSize: 10
});

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / query.pageSize)));
const allPageSelected = computed(
  () => rows.value.length > 0 && rows.value.every(row => selectedIds.value.includes(row.id))
);

function messageTypeText(type: MessageListItem["messageType"]) {
  return type === "ANNOUNCEMENT" ? "公告" : "通知";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
}

async function loadRows() {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await getMessages({
      title: query.title.trim() || undefined,
      messageType: query.messageType || undefined,
      readStatus: query.readStatus || undefined,
      sentStartAt: query.sentStartAt || undefined,
      sentEndAt: query.sentEndAt || undefined,
      page: query.page,
      pageSize: query.pageSize
    });
    rows.value = result.items;
    total.value = result.total;
    selectedIds.value = [];
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "消息列表加载失败";
  } finally {
    loading.value = false;
  }
}

function applyFilters() {
  query.page = 1;
  void loadRows();
}

function toggleMessageSelection(id: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedIds.value = checked
    ? [...new Set([...selectedIds.value, id])]
    : selectedIds.value.filter(selectedId => selectedId !== id);
}

function togglePageSelection(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedIds.value = checked ? rows.value.map(row => row.id) : [];
}

async function refreshUnreadCount() {
  try {
    notificationStore.unreadMessageCount = await getUnreadMessageCount();
  } catch {
    // Keep the last count visible if the counter request fails.
  }
}

async function openDetail(row: MessageListItem) {
  detailOpen.value = true;
  detailLoading.value = true;
  try {
    detail.value = await getMessage(row.id);
  } catch (error) {
    detail.value = null;
    message(error instanceof Error ? error.message : "消息详情加载失败", {
      type: "error"
    });
  } finally {
    detailLoading.value = false;
  }
}

function closeDetail() {
  detailOpen.value = false;
  detail.value = null;
}

async function handleRead(row: MessageListItem | MessageDetail) {
  try {
    await markMessageRead(row.id);
    await Promise.all([loadRows(), refreshUnreadCount()]);
    if (detail.value?.id === row.id) detail.value = await getMessage(row.id);
    message("已标记为已读", { type: "success" });
  } catch (error) {
    message(error instanceof Error ? error.message : "标记已读失败", {
      type: "error"
    });
  }
}

async function handleBatchRead(all = false) {
  if (!all && selectedIds.value.length === 0) {
    message("请先选择消息", { type: "warning" });
    return;
  }
  try {
    const result = await markMessagesRead(
      all ? { all: true } : { ids: selectedIds.value }
    );
    await Promise.all([loadRows(), refreshUnreadCount()]);
    message(`已标记 ${result.count} 条消息为已读`, { type: "success" });
  } catch (error) {
    message(error instanceof Error ? error.message : "批量已读失败", {
      type: "error"
    });
  }
}

watch(
  () => notificationStore.messageRevision,
  () => {
    void loadRows();
    if (detail.value) void openDetail(rows.value.find(row => row.id === detail.value?.id) ?? detail.value);
  }
);

onMounted(() => {
  void notificationStore.startMessageUpdates();
  void loadRows();
});
</script>

<template>
  <main class="space-y-5 p-4 sm:p-6" aria-labelledby="message-page-title">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm font-medium text-primary">收件箱</p>
        <h1 id="message-page-title" class="mt-1 text-2xl font-semibold tracking-tight">
          消息中心
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">查看通知与公告，并管理未读状态。</p>
      </div>
      <Badge variant="secondary" class="gap-2 px-3 py-1.5">
        <Mail class="size-4" aria-hidden="true" />
        {{ notificationStore.unreadMessageCount }} 条未读
      </Badge>
    </header>

    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">筛选消息</CardTitle>
        <CardDescription>按标题、类型、状态或发送日期筛选。</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" @submit.prevent="applyFilters">
          <div class="space-y-2 sm:col-span-2 xl:col-span-2">
            <Label for="message-title-filter">标题</Label>
            <Input
              id="message-title-filter"
              v-model="query.title"
              placeholder="搜索消息标题"
            />
          </div>
          <div class="space-y-2">
            <Label for="message-type-filter">类型</Label>
            <select
              id="message-type-filter"
              v-model="query.messageType"
              class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">全部类型</option>
              <option value="NOTICE">通知</option>
              <option value="ANNOUNCEMENT">公告</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="message-status-filter">状态</Label>
            <select
              id="message-status-filter"
              v-model="query.readStatus"
              class="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">全部状态</option>
              <option value="unread">未读</option>
              <option value="read">已读</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="message-start-date">开始日期</Label>
            <Input id="message-start-date" v-model="query.sentStartAt" type="date" />
          </div>
          <div class="space-y-2">
            <Label for="message-end-date">结束日期</Label>
            <Input id="message-end-date" v-model="query.sentEndAt" type="date" />
          </div>
          <div class="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-6">
            <Button type="submit">查询</Button>
            <Button type="button" variant="outline" :disabled="loading" @click="loadRows">
              <RefreshCw :class="['size-4', loading && 'animate-spin']" aria-hidden="true" />
              刷新
            </Button>
            <Button
              type="button"
              variant="secondary"
              :disabled="selectedIds.length === 0"
              @click="handleBatchRead(false)"
            >
              <MailOpen class="size-4" aria-hidden="true" />
              选中已读
            </Button>
            <Button type="button" variant="ghost" @click="handleBatchRead(true)">
              全部未读设为已读
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="p-0">
        <div v-if="loadError" class="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          {{ loadError }}
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] text-left text-sm">
            <thead class="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th class="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="选择当前页消息"
                    :checked="allPageSelected"
                    @change="togglePageSelection"
                  />
                </th>
                <th class="px-4 py-3 font-medium">标题</th>
                <th class="w-28 px-4 py-3 font-medium">类型</th>
                <th class="w-24 px-4 py-3 font-medium">状态</th>
                <th class="w-48 px-4 py-3 font-medium">发送时间</th>
                <th class="w-40 px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && rows.length === 0">
                <td colspan="6" class="px-4 py-12 text-center text-muted-foreground">
                  <span class="inline-flex items-center gap-2">
                    <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
                    正在加载消息
                  </span>
                </td>
              </tr>
              <tr v-else-if="rows.length === 0">
                <td colspan="6" class="px-4 py-12 text-center">
                  <Inbox class="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                  <p class="mt-3 font-medium">暂无消息</p>
                  <p class="mt-1 text-sm text-muted-foreground">新消息会在到达后自动显示。</p>
                </td>
              </tr>
              <tr
                v-for="row in rows"
                :key="row.id"
                class="border-b last:border-0 hover:bg-muted/30"
                :class="!row.readStatus && 'bg-primary/[0.025]'"
              >
                <td class="px-4 py-3">
                  <input
                    type="checkbox"
                    :aria-label="`选择消息：${row.title}`"
                    :checked="selectedIds.includes(row.id)"
                    @change="toggleMessageSelection(row.id, $event)"
                  />
                </td>
                <td class="px-4 py-3">
                  <button type="button" class="text-left font-medium hover:text-primary" @click="openDetail(row)">
                    {{ row.title }}
                  </button>
                  <p class="mt-1 max-w-2xl truncate text-xs text-muted-foreground">
                    {{ row.summary || "无摘要" }}
                  </p>
                </td>
                <td class="px-4 py-3">
                  <Badge variant="outline">{{ messageTypeText(row.messageType) }}</Badge>
                </td>
                <td class="px-4 py-3">
                  <Badge :variant="row.readStatus ? 'secondary' : 'default'">
                    {{ row.readStatus ? "已读" : "未读" }}
                  </Badge>
                </td>
                <td class="px-4 py-3 text-muted-foreground">{{ formatDate(row.sentAt) }}</td>
                <td class="px-4 py-3 text-right">
                  <Button variant="ghost" size="sm" @click="openDetail(row)">查看</Button>
                  <Button
                    v-if="!row.readStatus"
                    variant="link"
                    size="sm"
                    @click="handleRead(row)"
                  >
                    标为已读
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer class="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
          <p class="text-muted-foreground">共 {{ total }} 条，第 {{ query.page }} / {{ pageCount }} 页</p>
          <div class="flex items-center gap-2">
            <select
              v-model.number="query.pageSize"
              aria-label="每页条数"
              class="h-9 rounded-md border border-input bg-background px-2 text-sm"
              @change="applyFilters"
            >
              <option :value="10">每页 10 条</option>
              <option :value="20">每页 20 条</option>
              <option :value="50">每页 50 条</option>
            </select>
            <Button
              variant="outline"
              size="icon"
              aria-label="上一页"
              :disabled="query.page <= 1 || loading"
              @click="query.page--; loadRows()"
            >
              <ArrowLeft class="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="下一页"
              :disabled="query.page >= pageCount || loading"
              @click="query.page++; loadRows()"
            >
              <ArrowRight class="size-4" aria-hidden="true" />
            </Button>
          </div>
        </footer>
      </CardContent>
    </Card>

    <div
      v-if="detailOpen"
      class="fixed inset-0 z-[3000] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      @click.self="closeDetail"
      @keydown.esc="closeDetail"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-detail-title"
        class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border bg-background p-6 shadow-xl"
      >
        <header class="flex items-start justify-between gap-4">
          <div>
            <p class="text-sm text-muted-foreground">{{ detail ? messageTypeText(detail.messageType) : "消息详情" }}</p>
            <h2 id="message-detail-title" class="mt-1 text-xl font-semibold">
              {{ detail?.title || "消息详情" }}
            </h2>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭消息详情" @click="closeDetail">
            <X class="size-4" aria-hidden="true" />
          </Button>
        </header>
        <div v-if="detailLoading" class="flex justify-center py-12">
          <LoaderCircle class="size-5 animate-spin text-primary" aria-label="正在加载详情" />
        </div>
        <div v-else-if="detail" class="mt-5 space-y-4">
          <div class="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <Badge :variant="detail.readStatus ? 'secondary' : 'default'">
              {{ detail.readStatus ? "已读" : "未读" }}
            </Badge>
            <span>发送于 {{ formatDate(detail.sentAt) }}</span>
            <span v-if="detail.readAt">阅读于 {{ formatDate(detail.readAt) }}</span>
          </div>
          <p v-if="detail.summary" class="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            {{ detail.summary }}
          </p>
          <div class="whitespace-pre-wrap break-words leading-7 text-foreground">
            {{ detail.content }}
          </div>
          <div v-if="!detail.readStatus" class="flex justify-end border-t pt-4">
            <Button @click="handleRead(detail)">标为已读</Button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
