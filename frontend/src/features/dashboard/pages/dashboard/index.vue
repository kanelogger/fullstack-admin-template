<script setup lang="ts">
import { Skeleton } from "@/components/ui/skeleton";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { DashboardOperation, DashboardOverview } from "@template/contracts";
import { getDashboardOverview } from "@/features/dashboard/dashboard.service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, ListTodo, RefreshCw, UsersRound } from "@lucide/vue";
import { useNotificationStoreHook } from "@/stores/modules/notification";

defineOptions({ name: "Welcome" });

const loading = ref(true);
const loadError = ref<string | null>(null);
const overview = ref<DashboardOverview | null>(null);
const router = useRouter();
const notificationStore = useNotificationStoreHook();

const metrics = computed(() => [
  {
    label: "待处理数",
    value: overview.value?.todoCount ?? 0,
    icon: ListTodo,
    hint: "来自未读收件箱"
  },
  {
    label: "今日登录",
    value: overview.value?.adminStats?.todayLoginCount ?? "-",
    icon: UsersRound,
    hint: "今日系统登录次数"
  },
  {
    label: "今日异常",
    value: overview.value?.adminStats?.apiErrorCount ?? "-",
    icon: Activity,
    hint: "今日接口异常数"
  }
]);

const adminMetrics = computed(() => {
  const stats = overview.value?.adminStats;
  if (!stats) return [];
  return [
    { label: "用户数", value: stats.userCount },
    { label: "角色数", value: stats.roleCount },
    { label: "菜单数", value: stats.menuCount }
  ].filter((metric) => metric.value !== null);
});

function resolveError(error: unknown, fallback: string): string {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  const outer = record(error);
  const response = record(outer?.response);
  const responseData = record(response?.data);
  const apiError = record(responseData?.error) ?? record(outer?.error);
  const message = apiError?.message ?? outer?.message;
  return typeof message === "string" && message.length > 0 ? message : fallback;
}

function messageTypeText(type: string) {
  const map: Record<string, string> = {
    NOTICE: "通知",
    ANNOUNCEMENT: "公告"
  };
  return map[type] ?? type;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
}

function openMessage(id: string) {
  void router.push({ path: "/operation/messages", query: { messageId: id } });
}

function operationText(item: DashboardOperation) {
  return `${item.moduleCode} / ${item.operationType}`;
}

async function loadOverview() {
  loading.value = true;
  loadError.value = null;
  try {
    overview.value = await getDashboardOverview();
  } catch (error) {
    loadError.value = resolveError(error, "首页数据加载失败");
  } finally {
    loading.value = false;
  }
}

onMounted(loadOverview);
watch(
  () => notificationStore.messageRevision,
  () => void loadOverview()
);
</script>

<template>
  <main class="dashboard-page" :aria-busy="loading">
    <header class="dashboard-header">
      <div>
        <p class="text-sm font-medium text-primary">工作台</p>
        <h1 class="mt-1 text-2xl font-semibold tracking-tight text-foreground">系统概览</h1>
        <p class="mt-1 text-sm text-muted-foreground">查看近期消息与系统运行情况。</p>
      </div>
      <Button v-if="overview" variant="outline" size="sm" :disabled="loading" @click="loadOverview">
        <RefreshCw class="size-4" :class="loading && 'animate-spin'" aria-hidden="true" />
        刷新数据
      </Button>
    </header>

    <section v-if="loading && !overview" class="dashboard-metric-grid" aria-label="正在加载概览">
      <Skeleton v-for="item in 4" :key="item" class="h-32 rounded-xl" />
    </section>

    <Card v-else-if="loadError && !overview" role="alert" class="border-destructive/40">
      <CardHeader>
        <CardTitle>首页数据加载失败</CardTitle>
        <CardDescription>{{ loadError }}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" :disabled="loading" @click="loadOverview">重试</Button>
      </CardContent>
    </Card>

    <div v-if="overview" class="dashboard-overview">
      <Card
        v-if="loadError"
        role="status"
        class="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
      >
        <CardContent class="p-4 text-sm">
          刷新失败：{{ loadError }}。当前显示上一次成功加载的数据。
        </CardContent>
      </Card>

      <section class="dashboard-metric-grid" aria-label="数据概览">
        <Card v-for="metric in metrics" :key="metric.label" class="min-w-0">
          <CardContent class="flex items-start justify-between gap-4 p-5">
            <div class="min-w-0">
              <p class="text-sm font-medium text-muted-foreground">{{ metric.label }}</p>
              <p class="mt-3 text-3xl font-semibold tracking-tight text-foreground">
                {{ metric.value }}
              </p>
              <p class="mt-1 text-xs text-muted-foreground">{{ metric.hint }}</p>
            </div>
            <span
              class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
            >
              <component :is="metric.icon" class="size-5" aria-hidden="true" />
            </span>
          </CardContent>
        </Card>
      </section>

      <section v-if="adminMetrics.length" class="dashboard-admin-grid" aria-label="管理数据">
        <Card v-for="metric in adminMetrics" :key="metric.label">
          <CardContent class="flex items-center justify-between p-5">
            <span class="text-sm text-muted-foreground">{{ metric.label }}</span>
            <span class="text-xl font-semibold text-foreground">{{ metric.value }}</span>
          </CardContent>
        </Card>
      </section>

      <section class="dashboard-detail-grid">
        <Card>
          <CardHeader class="border-b border-border/70 pb-4">
            <CardTitle>待处理消息</CardTitle>
            <CardDescription>打开消息并标记已读即可完成处理</CardDescription>
          </CardHeader>
          <CardContent class="divide-y divide-border/70 py-1">
            <p
              v-if="!overview?.todoMessages.length"
              class="py-8 text-center text-sm text-muted-foreground"
            >
              {{ loading ? "正在加载消息…" : "暂无待处理消息" }}
            </p>
            <article v-for="item in overview?.todoMessages ?? []" :key="item.id" class="py-3">
              <Button
                variant="ghost"
                class="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left"
                @click="openMessage(item.id)"
              >
                <span class="min-w-0 space-y-1">
                  <span class="block truncate font-medium">{{ item.title }}</span>
                  <span class="block truncate text-sm text-muted-foreground">{{
                    item.summary ?? messageTypeText(item.messageType)
                  }}</span>
                  <span class="block text-xs text-muted-foreground">{{
                    formatDate(item.sentAt)
                  }}</span>
                </span>
              </Button>
            </article>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="border-b border-border/70 pb-4">
            <CardTitle>最近消息</CardTitle>
            <CardDescription>你收到的最新通知与公告</CardDescription>
          </CardHeader>
          <CardContent class="divide-y divide-border/70 py-1">
            <p
              v-if="!overview?.recentMessages.length"
              class="py-8 text-center text-sm text-muted-foreground"
            >
              {{ loading ? "正在加载消息…" : "暂无消息" }}
            </p>
            <article
              v-for="item in overview?.recentMessages ?? []"
              :key="item.id"
              class="space-y-2 py-4"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="font-medium text-foreground">{{ item.title }}</h2>
                <Badge variant="secondary">{{ messageTypeText(item.messageType) }}</Badge>
              </div>
              <p class="text-sm leading-6 text-muted-foreground">{{ item.summary }}</p>
              <time class="block text-xs text-muted-foreground">{{ formatDate(item.sentAt) }}</time>
            </article>
          </CardContent>
        </Card>

        <Card>
          <CardHeader class="border-b border-border/70 pb-4">
            <CardTitle>最近操作</CardTitle>
            <CardDescription>系统内近期操作记录</CardDescription>
          </CardHeader>
          <CardContent class="divide-y divide-border/70 py-1">
            <p
              v-if="!overview?.recentOperations.length"
              class="py-8 text-center text-sm text-muted-foreground"
            >
              {{ loading ? "正在加载操作记录…" : "暂无操作记录" }}
            </p>
            <article
              v-for="item in overview?.recentOperations ?? []"
              :key="item.id"
              class="flex flex-wrap items-center justify-between gap-3 py-4"
            >
              <div class="min-w-0 space-y-1">
                <h2 class="truncate font-medium text-foreground">{{ operationText(item) }}</h2>
                <p class="text-sm text-muted-foreground">{{ item.operatorName ?? "系统" }}</p>
                <time class="block text-xs text-muted-foreground">{{ item.operatedAt }}</time>
              </div>
              <Badge :variant="item.operationResult === 1 ? 'default' : 'destructive'">
                {{ item.operationResult === 1 ? "成功" : "失败" }}
              </Badge>
            </article>
          </CardContent>
        </Card>
      </section>
    </div>
  </main>
</template>

<style scoped>
.dashboard-page {
  display: grid;
  gap: 1.5rem;
  padding: 1rem;
}

.dashboard-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 1rem;
}

.dashboard-overview {
  display: grid;
  min-width: 0;
  gap: 1.5rem;
}

.dashboard-metric-grid,
.dashboard-admin-grid,
.dashboard-detail-grid {
  display: grid;
  min-width: 0;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr);
}

@media (min-width: 40rem) {
  .dashboard-page {
    padding: 1.5rem;
  }

  .dashboard-metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-admin-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 39.999rem) {
  .dashboard-header {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
  }

  .dashboard-header > button {
    justify-self: start;
  }
}

@media (min-width: 80rem) {
  .dashboard-metric-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .dashboard-detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
