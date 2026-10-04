<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExceptionLog, LoginLog, OperationLog } from "@/contracts";
import {
  getExceptionLog,
  getExceptionLogs,
  getLoginLog,
  getLoginLogs,
  getOperationLog,
  getOperationLogs
} from "./audit-logs.service";

type AuditKind = "login" | "operation" | "exception";
type AuditRow = LoginLog | OperationLog | ExceptionLog;
type DetailField = { label: string; value: string; pre?: boolean };

const props = defineProps<{ kind: AuditKind }>();
const PAGE_SIZE = 10;
const loading = ref(false);
const detailLoading = ref(false);
const loadError = ref("");
const actionError = ref("");
const rows = ref<AuditRow[]>([]);
const selected = ref<AuditRow | null>(null);
const total = ref(0);
const page = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const resultFilter = computed({
  get: () => props.kind === "login" ? query.loginResult : query.operationResult,
  set: (value: string) => {
    if (props.kind === "login") query.loginResult = value;
    else query.operationResult = value;
  }
});
const query = reactive({
  loginName: "",
  loginResult: "",
  operatorName: "",
  moduleCode: "",
  operationType: "",
  operationResult: "",
  requestPath: "",
  errorType: "",
  handledStatus: "",
  startAt: "",
  endAt: ""
});

const title = computed(() => ({
  login: "登录日志",
  operation: "操作日志",
  exception: "异常日志"
}[props.kind]));
const description = computed(() => ({
  login: "记录账号密码登录成功与失败的尝试。",
  operation: "记录已迁移模块通过权限校验后的数据变更。",
  exception: "记录服务端处理失败的安全摘要。"
}[props.kind]));
const columns = computed(() => ({
  login: ["登录名", "IP", "结果", "失败原因", "登录时间", ""],
  operation: ["操作人", "模块", "类型", "请求", "结果", "操作时间", ""],
  exception: ["路径", "方法", "异常类型", "异常信息", "状态", "发生时间", ""]
}[props.kind]));

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function jsonText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[无法显示]";
  }
}

function cells(row: AuditRow): string[] {
  if (props.kind === "login" && "loginName" in row) {
    return [
      row.loginName,
      row.loginIp ?? "—",
      row.loginResult === 1 ? "成功" : "失败",
      row.failureReason ?? "—",
      formatTime(row.loggedAt)
    ];
  }
  if (props.kind === "operation" && "moduleCode" in row) {
    return [
      row.operatorName ?? "—",
      row.moduleCode,
      row.operationType,
      `${row.requestMethod} ${row.requestPath}`,
      row.operationResult === 1 ? "成功" : "失败",
      formatTime(row.operatedAt)
    ];
  }
  if (props.kind === "exception" && "errorType" in row) {
    return [
      row.requestPath,
      row.requestMethod,
      row.errorType,
      row.errorMessage,
      row.handledStatus === 1 ? "已处理" : "未处理",
      formatTime(row.occurredAt)
    ];
  }
  return [];
}

function detailFields(row: AuditRow): DetailField[] {
  if (props.kind === "login" && "loginName" in row) {
    return [
      { label: "登录名", value: row.loginName },
      { label: "IP", value: row.loginIp ?? "—" },
      { label: "结果", value: row.loginResult === 1 ? "成功" : "失败" },
      { label: "失败原因", value: row.failureReason ?? "—" },
      { label: "User Agent", value: row.userAgent ?? "—" },
      { label: "登录时间", value: formatTime(row.loggedAt) }
    ];
  }
  if (props.kind === "operation" && "moduleCode" in row) {
    return [
      { label: "操作人", value: row.operatorName ?? "—" },
      { label: "模块", value: row.moduleCode },
      { label: "类型", value: row.operationType },
      { label: "请求", value: `${row.requestMethod} ${row.requestPath}` },
      { label: "结果", value: row.operationResult === 1 ? "成功" : "失败" },
      { label: "请求参数", value: jsonText(row.requestParams), pre: true },
      { label: "错误信息", value: row.errorMessage ?? "—" },
      { label: "操作时间", value: formatTime(row.operatedAt) }
    ];
  }
  if (props.kind === "exception" && "errorType" in row) {
    return [
      { label: "请求", value: `${row.requestMethod} ${row.requestPath}` },
      { label: "异常类型", value: row.errorType },
      { label: "异常信息", value: row.errorMessage },
      { label: "处理状态", value: row.handledStatus === 1 ? "已处理" : "未处理" },
      { label: "堆栈摘要", value: row.stackSummary ?? "—", pre: true },
      { label: "发生时间", value: formatTime(row.occurredAt) }
    ];
  }
  return [];
}

async function loadRows() {
  loading.value = true;
  loadError.value = "";
  actionError.value = "";
  try {
    const dates = {
      startAt: query.startAt || undefined,
      endAt: query.endAt || undefined,
      page: page.value,
      pageSize: PAGE_SIZE
    };
    const result = props.kind === "login"
      ? await getLoginLogs({
          ...dates,
          loginName: query.loginName.trim() || undefined,
          loginResult: query.loginResult === "" ? undefined : Number(query.loginResult)
        })
      : props.kind === "operation"
        ? await getOperationLogs({
            ...dates,
            operatorName: query.operatorName.trim() || undefined,
            moduleCode: query.moduleCode.trim() || undefined,
            operationType: query.operationType.trim() || undefined,
            operationResult: query.operationResult === "" ? undefined : Number(query.operationResult)
          })
        : await getExceptionLogs({
            ...dates,
            requestPath: query.requestPath.trim() || undefined,
            errorType: query.errorType.trim() || undefined,
            handledStatus: query.handledStatus === "" ? undefined : Number(query.handledStatus)
          });
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    rows.value = [];
    total.value = 0;
    loadError.value = error instanceof Error ? error.message : `${title.value}加载失败`;
  } finally {
    loading.value = false;
  }
}

async function search() {
  page.value = 1;
  await loadRows();
}

async function showDetail(row: AuditRow) {
  detailLoading.value = true;
  actionError.value = "";
  try {
    selected.value = props.kind === "login"
      ? await getLoginLog(row.id)
      : props.kind === "operation"
        ? await getOperationLog(row.id)
        : await getExceptionLog(row.id);
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "日志详情加载失败";
  } finally {
    detailLoading.value = false;
  }
}

function changePage(nextPage: number) {
  if (nextPage < 1 || nextPage > pageCount.value || loading.value) return;
  page.value = nextPage;
  void loadRows();
}

onMounted(loadRows);
</script>

<template>
  <main class="space-y-5 p-4 md:p-6">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight">{{ title }}</h1>
      <p class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
    </header>

    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">筛选条件</CardTitle>
        <CardDescription>日志保存在 Supabase，并按审计读取权限过滤。</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" @submit.prevent="search">
          <div v-if="kind === 'login'" class="space-y-2">
            <Label for="audit-login-name">登录名</Label>
            <Input id="audit-login-name" v-model="query.loginName" maxlength="64" placeholder="登录名" />
          </div>
          <div v-if="kind === 'operation'" class="space-y-2">
            <Label for="audit-operator-name">操作人</Label>
            <Input id="audit-operator-name" v-model="query.operatorName" maxlength="128" placeholder="操作人" />
          </div>
          <div v-if="kind === 'operation'" class="space-y-2">
            <Label for="audit-module">模块</Label>
            <Input id="audit-module" v-model="query.moduleCode" maxlength="64" placeholder="模块编码" />
          </div>
          <div v-if="kind === 'operation'" class="space-y-2">
            <Label for="audit-operation-type">类型</Label>
            <Input id="audit-operation-type" v-model="query.operationType" maxlength="32" placeholder="操作类型" />
          </div>
          <div v-if="kind === 'exception'" class="space-y-2">
            <Label for="audit-request-path">路径</Label>
            <Input id="audit-request-path" v-model="query.requestPath" maxlength="255" placeholder="请求路径" />
          </div>
          <div v-if="kind === 'exception'" class="space-y-2">
            <Label for="audit-error-type">异常类型</Label>
            <Input id="audit-error-type" v-model="query.errorType" maxlength="128" placeholder="异常类型" />
          </div>
          <div v-if="kind === 'login' || kind === 'operation'" class="space-y-2">
            <Label :for="kind === 'login' ? 'audit-login-result' : 'audit-operation-result'">结果</Label>
            <select
              :id="kind === 'login' ? 'audit-login-result' : 'audit-operation-result'"
              v-model="resultFilter"
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">全部</option>
              <option value="0">失败</option>
              <option value="1">成功</option>
            </select>
          </div>
          <div v-if="kind === 'exception'" class="space-y-2">
            <Label for="audit-handled-status">处理状态</Label>
            <select id="audit-handled-status" v-model="query.handledStatus" class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">全部</option>
              <option value="0">未处理</option>
              <option value="1">已处理</option>
            </select>
          </div>
          <div class="space-y-2">
            <Label for="audit-start-at">开始日期</Label>
            <Input id="audit-start-at" v-model="query.startAt" type="date" />
          </div>
          <div class="space-y-2">
            <Label for="audit-end-at">结束日期</Label>
            <Input id="audit-end-at" v-model="query.endAt" type="date" />
          </div>
          <div class="flex items-end">
            <Button type="submit" :disabled="loading">查询</Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="space-y-4 p-5">
        <p v-if="actionError" role="alert" class="text-sm text-destructive">{{ actionError }}</p>
        <div v-if="loadError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <p>{{ loadError }}</p>
          <Button class="mt-3" size="sm" variant="outline" @click="loadRows">重试</Button>
        </div>
        <div class="overflow-x-auto rounded-md border border-border">
          <table class="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead class="bg-muted/60 text-muted-foreground">
              <tr>
                <th v-for="(column, index) in columns" :key="`${column}-${index}`" scope="col" class="px-4 py-3 font-medium">{{ column }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading"><td :colspan="columns.length" class="px-4 py-10 text-center text-muted-foreground">正在加载{{ title }}…</td></tr>
              <tr v-else-if="!loadError && rows.length === 0"><td :colspan="columns.length" class="px-4 py-10 text-center text-muted-foreground">暂无{{ title }}</td></tr>
              <tr v-for="row in rows" :key="row.id" class="border-t border-border">
                <td v-for="(cell, index) in cells(row)" :key="index" class="max-w-72 truncate px-4 py-3" :title="cell">{{ cell }}</td>
                <td class="px-4 py-3 text-right"><Button size="sm" variant="ghost" @click="showDetail(row)">详情</Button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>共 {{ total }} 条</span>
          <div class="flex items-center gap-2">
            <Button variant="outline" size="sm" :disabled="page <= 1 || loading" @click="changePage(page - 1)">上一页</Button>
            <span>{{ page }} / {{ pageCount }}</span>
            <Button variant="outline" size="sm" :disabled="page >= pageCount || loading" @click="changePage(page + 1)">下一页</Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <div v-if="selected" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" :aria-label="`${title}详情`" @click.self="selected = null">
      <Card class="max-h-[90vh] w-full max-w-3xl overflow-auto shadow-xl">
        <CardHeader class="flex-row items-center justify-between border-b border-border/70">
          <div><CardTitle>{{ title }}详情</CardTitle><CardDescription v-if="detailLoading">正在加载详细信息…</CardDescription></div>
          <Button variant="outline" size="sm" @click="selected = null">关闭</Button>
        </CardHeader>
        <CardContent class="space-y-4 p-5">
          <dl v-for="field in detailFields(selected)" :key="field.label" class="grid gap-1 sm:grid-cols-[150px_1fr]">
            <dt class="text-sm font-medium text-muted-foreground">{{ field.label }}</dt>
            <dd v-if="field.pre" class="max-h-60 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">{{ field.value }}</dd>
            <dd v-else class="break-words text-sm">{{ field.value }}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  </main>
</template>
