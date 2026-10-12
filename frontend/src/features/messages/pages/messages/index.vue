<script setup lang="ts">
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  ArrowRight,
  Inbox,
  LoaderCircle,
  Mail,
  MailOpen,
  RefreshCw,
  X
} from "@lucide/vue";
import { useMessagesPage } from "@/features/messages/use-messages-page";

defineOptions({ name: "OperationMessage" });

/* eslint-disable @typescript-eslint/no-unused-vars -- These setup bindings are consumed by the Vue template. */
const {
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
} = useMessagesPage();
/* eslint-enable @typescript-eslint/no-unused-vars */
const { restore: restoreDetailFocus } = useDialogReturnFocus(detailOpen);
</script>

<template>
  <main class="space-y-5 p-4 sm:p-6" aria-labelledby="message-page-title">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="text-sm font-medium text-primary">收件箱</p>
        <h1 id="message-page-title" class="mt-1 text-2xl font-semibold tracking-tight">消息中心</h1>
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
        <form @submit.prevent="applyFilters">
          <FieldGroup class="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <Field class="space-y-2 sm:col-span-2 xl:col-span-2">
              <FieldLabel for="message-title-filter">标题</FieldLabel>
              <Input id="message-title-filter" v-model="query.title" placeholder="搜索消息标题" />
            </Field>
            <Field class="space-y-2">
              <FieldLabel for="message-type-filter">类型</FieldLabel>
              <NativeSelect
                wrapper-class="w-full"
                id="message-type-filter"
                v-model="query.messageType"
                class="h-10 w-full"
              >
                <NativeSelectOption value="">全部类型</NativeSelectOption>
                <NativeSelectOption value="NOTICE">通知</NativeSelectOption>
                <NativeSelectOption value="ANNOUNCEMENT">公告</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field class="space-y-2">
              <FieldLabel for="message-status-filter">状态</FieldLabel>
              <NativeSelect
                wrapper-class="w-full"
                id="message-status-filter"
                v-model="query.readStatus"
                class="h-10 w-full"
              >
                <NativeSelectOption value="">全部状态</NativeSelectOption>
                <NativeSelectOption value="unread">未读</NativeSelectOption>
                <NativeSelectOption value="read">已读</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field class="space-y-2">
              <FieldLabel for="message-start-date">开始日期</FieldLabel>
              <Input id="message-start-date" v-model="query.sentStartAt" type="date" />
            </Field>
            <Field class="space-y-2">
              <FieldLabel for="message-end-date">结束日期</FieldLabel>
              <Input id="message-end-date" v-model="query.sentEndAt" type="date" />
            </Field>
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
          </FieldGroup>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="p-0">
        <Alert variant="destructive" v-if="loadError" class="m-4"
          ><AlertDescription>
            {{ loadError }}
          </AlertDescription></Alert
        >
        <div class="overflow-x-auto">
          <Table class="w-full min-w-[760px] text-left">
            <TableHeader>
              <TableRow>
                <TableHead class="w-12">
                  <Checkbox
                    aria-label="选择当前页消息"
                    :model-value="allPageSelected"
                    @update:model-value="togglePageSelection"
                  />
                </TableHead>
                <TableHead>标题</TableHead>
                <TableHead class="w-28">类型</TableHead>
                <TableHead class="w-24">状态</TableHead>
                <TableHead class="w-48">发送时间</TableHead>
                <TableHead class="w-40 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading && rows.length === 0">
                <TableCell colspan="6" class="text-center">
                  <span class="inline-flex items-center gap-2">
                    <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
                    正在加载消息
                  </span>
                </TableCell>
              </TableRow>
              <TableRow v-else-if="rows.length === 0">
                <TableCell colspan="6" class="text-center">
                  <Inbox class="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                  <p class="mt-3 font-medium">暂无消息</p>
                  <p class="mt-1 text-sm text-muted-foreground">新消息会在到达后自动显示。</p>
                </TableCell>
              </TableRow>
              <TableRow
                v-for="row in rows"
                :key="row.id"
                :class="!row.readStatus && 'bg-primary/[0.025]'"
              >
                <TableCell>
                  <Checkbox
                    :aria-label="`选择消息：${row.title}`"
                    :model-value="selectedIds.includes(row.id)"
                    @update:model-value="toggleMessageSelection(row.id, $event)"
                  />
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    class="text-left font-medium hover:text-primary"
                    @click="openDetail(row)"
                  >
                    {{ row.title }}
                  </button>
                  <p class="mt-1 max-w-2xl truncate text-xs text-muted-foreground">
                    {{ row.summary || "无摘要" }}
                  </p>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{{ messageTypeText(row.messageType) }}</Badge>
                </TableCell>
                <TableCell>
                  <Badge :variant="row.readStatus ? 'secondary' : 'default'">
                    {{ row.readStatus ? "已读" : "未读" }}
                  </Badge>
                </TableCell>
                <TableCell>{{ formatDate(row.sentAt) }}</TableCell>
                <TableCell class="text-right">
                  <Button variant="ghost" size="sm" @click="openDetail(row)">查看</Button>
                  <Button v-if="!row.readStatus" variant="link" size="sm" @click="handleRead(row)">
                    标为已读
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <footer
          class="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm"
        >
          <p class="text-muted-foreground">
            共 {{ total }} 条，第 {{ query.page }} / {{ pageCount }} 页
          </p>
          <div class="flex items-center gap-2">
            <NativeSelect
              v-model.number="query.pageSize"
              aria-label="每页条数"
              class="h-9"
              @update:model-value="applyFilters"
            >
              <NativeSelectOption :value="10">每页 10 条</NativeSelectOption>
              <NativeSelectOption :value="20">每页 20 条</NativeSelectOption>
              <NativeSelectOption :value="50">每页 50 条</NativeSelectOption>
            </NativeSelect>
            <Button
              variant="outline"
              size="icon"
              aria-label="上一页"
              :disabled="query.page <= 1 || loading"
              @click="
                query.page--;
                loadRows();
              "
            >
              <ArrowLeft class="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="下一页"
              :disabled="query.page >= pageCount || loading"
              @click="
                query.page++;
                loadRows();
              "
            >
              <ArrowRight class="size-4" aria-hidden="true" />
            </Button>
          </div>
        </footer>
      </CardContent>
    </Card>

    <Dialog
      :open="detailOpen"
      @update:open="
        (open) => {
          if (!open) closeDetail();
        }
      "
    >
      <DialogContent
        class="max-h-[90vh] w-full sm:max-w-2xl overflow-y-auto"
        @close-auto-focus="restoreDetailFocus"
      >
        <DialogHeader class="flex-row items-start justify-between gap-4">
          <div>
            <DialogDescription>{{
              detail ? messageTypeText(detail.messageType) : "消息详情"
            }}</DialogDescription>
            <DialogTitle class="mt-1 text-xl">
              {{ detail?.title || "消息详情" }}
            </DialogTitle>
          </div>
          <DialogClose as-child
            ><Button variant="ghost" size="icon" aria-label="关闭消息详情">
              <X class="size-4" aria-hidden="true" /> </Button
          ></DialogClose>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  </main>
</template>
