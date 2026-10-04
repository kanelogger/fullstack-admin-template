<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AttachmentListRequestSchema, type Attachment } from "@/contracts";
import {
  deleteAttachment,
  downloadAttachment,
  getAttachments,
  uploadAttachment
} from "@/features/attachments/attachments.service";
import { useUserStore } from "@/store/modules/user";

defineOptions({ name: "OperationAttachment" });

const PAGE_SIZE = 10;
const userStore = useUserStore();
const permissions = computed(() => new Set(userStore.permissions));
const canUpload = computed(() => permissions.value.has("files.attachments.upload"));
const canDelete = computed(() => permissions.value.has("files.attachments.delete"));
const loading = ref(false);
const uploading = ref(false);
const rows = ref<Attachment[]>([]);
const total = ref(0);
const page = ref(1);
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const pageError = ref("");
const actionMessage = ref("");
const selectedFile = ref<HTMLInputElement | null>(null);
const previewUrl = ref("");
const previewName = ref("");
const filters = reactive({ originalName: "", businessModule: "", referenceStatus: "" });
const uploadForm = reactive({ businessModule: "", businessRecordId: "" });

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function revokePreview() {
  if (!previewUrl.value) return;
  URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
  previewName.value = "";
}

async function loadRows() {
  loading.value = true;
  pageError.value = "";
  try {
    const request = AttachmentListRequestSchema.parse({
      originalName: filters.originalName.trim() || undefined,
      businessModule: filters.businessModule.trim() || undefined,
      referenceStatus:
        filters.referenceStatus === "" ? undefined : Number(filters.referenceStatus),
      page: page.value,
      pageSize: PAGE_SIZE
    });
    const result = await getAttachments(request);
    rows.value = result.items;
    total.value = result.total;
  } catch (error) {
    rows.value = [];
    total.value = 0;
    pageError.value = errorText(error, "附件列表加载失败");
  } finally {
    loading.value = false;
  }
}

async function search() {
  page.value = 1;
  await loadRows();
}

async function chooseFile() {
  selectedFile.value?.click();
}

async function uploadSelectedFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  actionMessage.value = "";
  try {
    const businessModule = uploadForm.businessModule.trim() || null;
    const businessRecordId = uploadForm.businessRecordId.trim() || null;
    await uploadAttachment(file, { businessModule, businessRecordId });
    actionMessage.value = `已上传 ${file.name}`;
    input.value = "";
    await loadRows();
  } catch (error) {
    actionMessage.value = errorText(error, "附件上传失败");
  } finally {
    uploading.value = false;
  }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function download(row: Attachment) {
  actionMessage.value = "";
  try {
    const result = await downloadAttachment(row.id);
    saveBlob(result.blob, result.attachment.originalName);
  } catch (error) {
    actionMessage.value = errorText(error, "附件下载失败");
  }
}

async function preview(row: Attachment) {
  if (!row.mimeType.toLowerCase().startsWith("image/")) return;
  actionMessage.value = "";
  try {
    const result = await downloadAttachment(row.id);
    revokePreview();
    previewName.value = result.attachment.originalName;
    previewUrl.value = URL.createObjectURL(result.blob);
  } catch (error) {
    actionMessage.value = errorText(error, "附件预览失败");
  }
}

async function remove(row: Attachment) {
  if (!window.confirm(`确认删除附件“${row.originalName}”？`)) return;
  actionMessage.value = "";
  try {
    await deleteAttachment(row.id);
    actionMessage.value = `已删除 ${row.originalName}`;
    await loadRows();
  } catch (error) {
    actionMessage.value = errorText(error, "附件删除失败");
  }
}

async function changePage(nextPage: number) {
  if (nextPage < 1 || nextPage > pageCount.value) return;
  page.value = nextPage;
  await loadRows();
}

onMounted(loadRows);
onUnmounted(revokePreview);
</script>

<template>
  <main class="space-y-5 p-4 md:p-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">附件管理</h1>
      <p class="mt-1 text-sm text-muted-foreground">私有存储中的附件仅向有权限的账号开放。</p>
    </div>

    <Card v-if="canUpload">
      <CardHeader class="pb-3">
        <CardTitle class="text-base">上传附件</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div class="space-y-2">
          <Label for="attachment-business-module">业务模块</Label>
          <Input id="attachment-business-module" v-model="uploadForm.businessModule" maxlength="64" placeholder="可选" />
        </div>
        <div class="space-y-2">
          <Label for="attachment-business-record">业务记录 ID</Label>
          <Input id="attachment-business-record" v-model="uploadForm.businessRecordId" inputmode="numeric" placeholder="可选十进制 ID" />
        </div>
        <div class="flex items-center gap-3">
          <input
            ref="selectedFile"
            class="sr-only"
            type="file"
            aria-label="选择附件"
            @change="uploadSelectedFile"
          />
          <Button type="button" :disabled="uploading" @click="chooseFile">
            {{ uploading ? "正在上传…" : "选择文件并上传" }}
          </Button>
          <span class="text-xs text-muted-foreground">最大 20 MiB</span>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader class="pb-3">
        <CardTitle class="text-base">附件列表</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <form class="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end" @submit.prevent="search">
          <div class="space-y-2">
            <Label for="attachment-search-name">文件名</Label>
            <Input id="attachment-search-name" v-model="filters.originalName" maxlength="255" placeholder="搜索文件名" />
          </div>
          <div class="space-y-2">
            <Label for="attachment-search-module">业务模块</Label>
            <Input id="attachment-search-module" v-model="filters.businessModule" maxlength="64" placeholder="全部模块" />
          </div>
          <div class="space-y-2">
            <Label for="attachment-search-reference">引用状态</Label>
            <select
              id="attachment-search-reference"
              v-model="filters.referenceStatus"
              class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">全部</option>
              <option value="0">未引用</option>
              <option value="1">已引用</option>
            </select>
          </div>
          <Button type="submit" variant="outline">查询</Button>
        </form>

        <p v-if="actionMessage" role="status" class="text-sm text-muted-foreground">{{ actionMessage }}</p>
        <div v-if="pageError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          <p>{{ pageError }}</p>
          <Button class="mt-3" size="sm" variant="outline" @click="loadRows">重试</Button>
        </div>

        <div class="overflow-x-auto rounded-md border border-border">
          <table class="w-full min-w-[850px] border-collapse text-left text-sm">
            <thead class="bg-muted/60 text-muted-foreground">
              <tr>
                <th scope="col" class="px-4 py-3 font-medium">文件名</th>
                <th scope="col" class="px-4 py-3 font-medium">MIME</th>
                <th scope="col" class="px-4 py-3 font-medium">大小</th>
                <th scope="col" class="px-4 py-3 font-medium">业务</th>
                <th scope="col" class="px-4 py-3 font-medium">引用</th>
                <th scope="col" class="px-4 py-3 font-medium">上传时间</th>
                <th scope="col" class="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading">
                <td colspan="7" class="px-4 py-10 text-center text-muted-foreground">正在加载附件…</td>
              </tr>
              <tr v-else-if="!pageError && rows.length === 0">
                <td colspan="7" class="px-4 py-10 text-center text-muted-foreground">暂无附件</td>
              </tr>
              <tr v-for="row in rows" :key="row.id" class="border-t border-border">
                <td class="max-w-64 truncate px-4 py-3 font-medium" :title="row.originalName">{{ row.originalName }}</td>
                <td class="px-4 py-3 text-muted-foreground">{{ row.mimeType }}</td>
                <td class="whitespace-nowrap px-4 py-3">{{ formatSize(row.fileSize) }}</td>
                <td class="px-4 py-3">{{ row.businessModule ?? "—" }}<span v-if="row.businessRecordId"> / {{ row.businessRecordId }}</span></td>
                <td class="px-4 py-3">
                  <span class="rounded-full px-2 py-1 text-xs" :class="row.referenceStatus === 1 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'">
                    {{ row.referenceStatus === 1 ? "已引用" : "未引用" }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-muted-foreground">{{ new Date(row.uploadedAt).toLocaleString() }}</td>
                <td class="whitespace-nowrap px-4 py-3 text-right">
                  <Button v-if="row.mimeType.toLowerCase().startsWith('image/')" size="sm" variant="ghost" @click="preview(row)">预览</Button>
                  <Button size="sm" variant="ghost" @click="download(row)">下载</Button>
                  <Button v-if="canDelete" size="sm" variant="ghost" class="text-destructive hover:text-destructive" @click="remove(row)">删除</Button>
                </td>
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

    <div
      v-if="previewUrl"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      :aria-label="`预览 ${previewName}`"
      @click.self="revokePreview"
    >
      <div class="relative max-h-[90vh] max-w-[90vw] rounded-lg bg-background p-3 shadow-xl">
        <div class="mb-2 flex items-center justify-between gap-4">
          <p class="max-w-[70vw] truncate text-sm font-medium">{{ previewName }}</p>
          <Button size="sm" variant="outline" @click="revokePreview">关闭</Button>
        </div>
        <img class="max-h-[78vh] max-w-[85vw] object-contain" :src="previewUrl" :alt="previewName" />
      </div>
    </div>
  </main>
</template>
