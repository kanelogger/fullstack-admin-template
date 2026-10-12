import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { message } from "@/utils/message";
import { type MessageDetail, type MessageListItem } from "@template/contracts";
import {
  getMessage,
  getMessages,
  markMessageRead,
  markMessagesRead
} from "@/features/messages/messages.service";
import { useNotificationStoreHook } from "@/stores/modules/notification";

export function useMessagesPage() {
  const notificationStore = useNotificationStoreHook();
  const route = useRoute();
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
    () => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.includes(row.id))
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

  function toggleMessageSelection(id: string, value: boolean | "indeterminate") {
    const checked = value === true;
    selectedIds.value = checked
      ? [...new Set([...selectedIds.value, id])]
      : selectedIds.value.filter((selectedId) => selectedId !== id);
  }

  function togglePageSelection(value: boolean | "indeterminate") {
    const checked = value === true;
    selectedIds.value = checked ? rows.value.map((row) => row.id) : [];
  }

  async function refreshUnreadCount() {
    await notificationStore.refreshUnreadMessageCount();
  }

  async function openDetail(row: Pick<MessageListItem, "id">) {
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
      const result = await markMessagesRead(all ? { all: true } : { ids: selectedIds.value });
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
      if (detail.value)
        void openDetail(rows.value.find((row) => row.id === detail.value?.id) ?? detail.value);
    }
  );

  onMounted(async () => {
    await loadRows();
    const messageId = route.query.messageId;
    if (typeof messageId === "string" && messageId.trim()) {
      await openDetail({ id: messageId });
    }
  });
  return {
    notificationStore,
    route,
    loading,
    detailLoading,
    detailOpen,
    loadError,
    rows,
    selectedIds,
    detail,
    total,
    query,
    pageCount,
    allPageSelected,
    messageTypeText,
    formatDate,
    loadRows,
    applyFilters,
    toggleMessageSelection,
    togglePageSelection,
    refreshUnreadCount,
    openDetail,
    closeDetail,
    handleRead,
    handleBatchRead
  };
}
