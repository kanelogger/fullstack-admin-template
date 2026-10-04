<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { DashboardOperation, DashboardOverview } from "@/contracts";
import { getDashboardOverview } from "@/features/dashboard/dashboard.service";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ListTodo,
  MessageSquareText,
  RefreshCw,
  UsersRound
} from "@lucide/vue";

defineOptions({ name: "Welcome" });

const loading = ref(true);
const loadError = ref<string | null>(null);
const overview = ref<DashboardOverview | null>(null);

const metrics = computed(() => [
  {
    label: "未读消息",
    value: overview.value?.unreadMessageCount ?? 0,
    icon: MessageSquareText,
    hint: "需要查看的消息"
  },
  {
    label: "我的待办",
    value: overview.value?.todoCount ?? 0,
    icon: ListTodo,
    hint: "当前待处理事项"
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
  ].filter(metric => metric.value !== null);
});

function resolveError(error: any, fallback: string) {
  return (
    error?.response?.data?.error?.message ??
    error?.error?.message ??
    error?.message ??
    fallback
  );
}

function messageTypeText(type: string) {
  const map: Record<string, string> = {
    NOTICE: "通知",
    ANNOUNCEMENT: "公告"
  };
  return map[type] ?? type;
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
</script>

<template>
  <main class="space-y-6 p-4 md:p-6" :aria-busy="loading">
    <header class="flex flex-wrap items-end justify-between gap-4">
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

    <section v-if="loading && !overview" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="正在加载概览">
      <div v-for="item in 4" :key="item" class="h-32 animate-pulse rounded-xl border border-border bg-card" />
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

    <div v-if="overview" class="space-y-6">
      <Card v-if="loadError" role="status" class="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
        <CardContent class="p-4 text-sm">
          刷新失败：{{ loadError }}。当前显示上一次成功加载的数据。
        </CardContent>
      </Card>

      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="数据概览">
        <Card v-for="metric in metrics" :key="metric.label" class="min-w-0">
          <CardContent class="flex items-start justify-between gap-4 p-5">
            <div class="min-w-0">
              <p class="text-sm font-medium text-muted-foreground">{{ metric.label }}</p>
              <p class="mt-3 text-3xl font-semibold tracking-tight text-foreground">{{ metric.value }}</p>
              <p class="mt-1 text-xs text-muted-foreground">{{ metric.hint }}</p>
            </div>
            <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <component :is="metric.icon" class="size-5" aria-hidden="true" />
            </span>
          </CardContent>
        </Card>
      </section>

      <section v-if="adminMetrics.length" class="grid gap-4 sm:grid-cols-3" aria-label="管理数据">
        <Card v-for="metric in adminMetrics" :key="metric.label">
          <CardContent class="flex items-center justify-between p-5">
            <span class="text-sm text-muted-foreground">{{ metric.label }}</span>
            <span class="text-xl font-semibold text-foreground">{{ metric.value }}</span>
          </CardContent>
        </Card>
      </section>

      <section class="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader class="border-b border-border/70 pb-4">
          <CardTitle>系统公告</CardTitle>
          <CardDescription>最近发布的通知与公告</CardDescription>
        </CardHeader>
        <CardContent class="divide-y divide-border/70 py-1">
          <p v-if="!overview?.announcements.length" class="py-8 text-center text-sm text-muted-foreground">
            {{ loading ? "正在加载公告…" : "暂无公告" }}
          </p>
          <article v-for="item in overview?.announcements ?? []" :key="item.id" class="space-y-2 py-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="font-medium text-foreground">{{ item.title }}</h2>
              <Badge variant="secondary">{{ messageTypeText(item.messageType) }}</Badge>
            </div>
            <p class="text-sm leading-6 text-muted-foreground">{{ item.summary }}</p>
            <time class="block text-xs text-muted-foreground">{{ item.sentAt }}</time>
          </article>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="border-b border-border/70 pb-4">
          <CardTitle>最近操作</CardTitle>
          <CardDescription>系统内近期操作记录</CardDescription>
        </CardHeader>
        <CardContent class="divide-y divide-border/70 py-1">
          <p v-if="!overview?.recentOperations.length" class="py-8 text-center text-sm text-muted-foreground">
            {{ loading ? "正在加载操作记录…" : "暂无操作记录" }}
          </p>
          <article v-for="item in overview?.recentOperations ?? []" :key="item.id" class="flex flex-wrap items-center justify-between gap-3 py-4">
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
