<script setup lang="ts">
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuditLogPage, type AuditKind } from "@/features/audit/use-audit-log-page";

const props = defineProps<{ kind: AuditKind }>();

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
  PAGE_SIZE,
  loading,
  detailLoading,
  loadError,
  actionError,
  rows,
  selected,
  detailRequest,
  captureDetailFocus,
  restoreDetailFocus,
  total,
  page,
  pageCount,
  resultFilter,
  query,
  title,
  description,
  columns,
  formatTime,
  jsonText,
  cells,
  detailFields,
  loadRows,
  search,
  closeDetail,
  showDetail,
  changePage
} = useAuditLogPage(props);
/* eslint-enable @typescript-eslint/no-unused-vars */
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
        <form @submit.prevent="search">
          <FieldGroup class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Field v-if="kind === 'login'" class="space-y-2">
              <FieldLabel for="audit-login-name">登录名</FieldLabel>
              <Input
                id="audit-login-name"
                v-model="query.loginName"
                maxlength="64"
                placeholder="登录名"
              />
            </Field>
            <Field v-if="kind === 'operation'" class="space-y-2">
              <FieldLabel for="audit-operator-name">操作人</FieldLabel>
              <Input
                id="audit-operator-name"
                v-model="query.operatorName"
                maxlength="128"
                placeholder="操作人"
              />
            </Field>
            <Field v-if="kind === 'operation'" class="space-y-2">
              <FieldLabel for="audit-module">模块</FieldLabel>
              <Input
                id="audit-module"
                v-model="query.moduleCode"
                maxlength="64"
                placeholder="模块编码"
              />
            </Field>
            <Field v-if="kind === 'operation'" class="space-y-2">
              <FieldLabel for="audit-operation-type">类型</FieldLabel>
              <Input
                id="audit-operation-type"
                v-model="query.operationType"
                maxlength="32"
                placeholder="操作类型"
              />
            </Field>
            <Field v-if="kind === 'exception'" class="space-y-2">
              <FieldLabel for="audit-request-path">路径</FieldLabel>
              <Input
                id="audit-request-path"
                v-model="query.requestPath"
                maxlength="255"
                placeholder="请求路径"
              />
            </Field>
            <Field v-if="kind === 'exception'" class="space-y-2">
              <FieldLabel for="audit-error-type">异常类型</FieldLabel>
              <Input
                id="audit-error-type"
                v-model="query.errorType"
                maxlength="128"
                placeholder="异常类型"
              />
            </Field>
            <Field v-if="kind === 'login' || kind === 'operation'" class="space-y-2">
              <FieldLabel :for="kind === 'login' ? 'audit-login-result' : 'audit-operation-result'"
                >结果</FieldLabel
              >
              <NativeSelect
                wrapper-class="w-full"
                :id="kind === 'login' ? 'audit-login-result' : 'audit-operation-result'"
                v-model="resultFilter"
                class="h-10 w-full"
              >
                <NativeSelectOption value="">全部</NativeSelectOption>
                <NativeSelectOption value="0">失败</NativeSelectOption>
                <NativeSelectOption value="1">成功</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field v-if="kind === 'exception'" class="space-y-2">
              <FieldLabel for="audit-handled-status">处理状态</FieldLabel>
              <NativeSelect
                wrapper-class="w-full"
                id="audit-handled-status"
                v-model="query.handledStatus"
                class="h-10 w-full"
              >
                <NativeSelectOption value="">全部</NativeSelectOption>
                <NativeSelectOption value="0">未处理</NativeSelectOption>
                <NativeSelectOption value="1">已处理</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field class="space-y-2">
              <FieldLabel for="audit-start-at">开始日期</FieldLabel>
              <Input id="audit-start-at" v-model="query.startAt" type="date" />
            </Field>
            <Field class="space-y-2">
              <FieldLabel for="audit-end-at">结束日期</FieldLabel>
              <Input id="audit-end-at" v-model="query.endAt" type="date" />
            </Field>
            <div class="flex items-end">
              <Button type="submit" :disabled="loading">查询</Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="space-y-4 p-5">
        <Alert variant="destructive" v-if="actionError"
          ><AlertDescription>{{ actionError }}</AlertDescription></Alert
        >
        <Alert variant="destructive" v-if="loadError"
          ><AlertDescription>
            <p>{{ loadError }}</p>
            <Button class="mt-3" size="sm" variant="outline" @click="loadRows">重试</Button>
          </AlertDescription></Alert
        >
        <div class="overflow-x-auto rounded-md border border-border">
          <Table class="w-full min-w-[760px] text-left">
            <TableHeader>
              <TableRow>
                <TableHead
                  v-for="(column, index) in columns"
                  :key="`${column}-${index}`"
                  scope="col"
                  >{{ column }}</TableHead
                >
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading"
                ><TableCell :colspan="columns.length" class="text-center"
                  >正在加载{{ title }}…</TableCell
                ></TableRow
              >
              <TableRow v-else-if="!loadError && rows.length === 0"
                ><TableCell :colspan="columns.length" class="text-center"
                  >暂无{{ title }}</TableCell
                ></TableRow
              >
              <TableRow v-for="row in rows" :key="row.id">
                <TableCell
                  v-for="(cell, index) in cells(row)"
                  :key="index"
                  class="max-w-72"
                  :title="cell"
                  >{{ cell }}</TableCell
                >
                <TableCell class="text-right"
                  ><Button size="sm" variant="ghost" @click="showDetail(row)"
                    >详情</Button
                  ></TableCell
                >
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div class="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <span>共 {{ total }} 条</span>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              :disabled="page <= 1 || loading"
              @click="changePage(page - 1)"
              >上一页</Button
            >
            <span>{{ page }} / {{ pageCount }}</span>
            <Button
              variant="outline"
              size="sm"
              :disabled="page >= pageCount || loading"
              @click="changePage(page + 1)"
              >下一页</Button
            >
          </div>
        </div>
      </CardContent>
    </Card>

    <Dialog
      :open="selected !== null"
      @update:open="
        (open) => {
          if (!open) closeDetail();
        }
      "
    >
      <DialogContent
        v-if="selected"
        class="max-h-[90vh] w-full sm:max-w-3xl overflow-auto"
        @close-auto-focus="restoreDetailFocus"
      >
        <DialogHeader class="flex-row items-center justify-between border-b border-border/70">
          <div>
            <DialogTitle>{{ title }}详情</DialogTitle>
            <DialogDescription>{{
              detailLoading ? "正在加载详细信息…" : "查看此条审计记录的完整字段。"
            }}</DialogDescription>
          </div>
          <DialogClose as-child><Button variant="outline" size="sm">关闭</Button></DialogClose>
        </DialogHeader>
        <CardContent class="space-y-4 p-5">
          <dl
            v-for="field in detailFields(selected)"
            :key="field.label"
            class="grid gap-1 sm:grid-cols-[150px_1fr]"
          >
            <dt class="text-sm font-medium text-muted-foreground">{{ field.label }}</dt>
            <dd
              v-if="field.pre"
              class="max-h-60 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap"
            >
              {{ field.value }}
            </dd>
            <dd v-else class="break-words text-sm">{{ field.value }}</dd>
          </dl>
        </CardContent>
      </DialogContent>
    </Dialog>
  </main>
</template>
