<script setup lang="ts">
import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
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
import { requestConfirmation } from "@/composables/use-confirmation";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ATTACHMENT_ACCEPT } from "@template/contracts/attachments";
import { unrefElement } from "@vueuse/core";
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AttachmentListRequestSchema, type Attachment } from "@template/contracts";
import {
  deleteAttachment,
  downloadAttachment,
  getAttachments,
  uploadAttachment
} from "@/features/attachments/attachments.service";
import { usePermissionStoreHook } from "@/stores/modules/permission";

defineOptions({ name: "OperationAttachment" });

const PAGE_SIZE = 10;
const permissions = computed(() => new Set(usePermissionStoreHook().permissionKeys));
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
const selectedFile = ref<InstanceType<typeof Input> | null>(null);
const previewUrl = ref("");
const previewName = ref("");
const { capture: capturePreviewFocus, restore: restorePreviewFocus } = useDialogReturnFocus();
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
      referenceStatus: filters.referenceStatus === "" ? undefined : Number(filters.referenceStatus),
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

function chooseFile() {
  // `Input` is a component: its template ref is the component instance, not the native element.
  const input = unrefElement(selectedFile);
  if (input instanceof HTMLInputElement) input.click();
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
  capturePreviewFocus();
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
  if (!(await requestConfirmation(`确认删除附件“${row.originalName}”？`))) return;
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
        <Field class="space-y-2">
          <FieldLabel for="attachment-business-module">业务模块</FieldLabel>
          <Input
            id="attachment-business-module"
            v-model="uploadForm.businessModule"
            maxlength="64"
            placeholder="可选"
          />
        </Field>
        <Field class="space-y-2">
          <FieldLabel for="attachment-business-record">业务记录 ID</FieldLabel>
          <Input
            id="attachment-business-record"
            v-model="uploadForm.businessRecordId"
            inputmode="numeric"
            placeholder="可选十进制 ID"
          />
        </Field>
        <div class="flex items-center gap-3">
          <Input
            ref="selectedFile"
            class="sr-only"
            type="file"
            :accept="ATTACHMENT_ACCEPT"
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
        <form @submit.prevent="search">
          <FieldGroup class="grid gap-3 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end">
            <Field class="space-y-2">
              <FieldLabel for="attachment-search-name">文件名</FieldLabel>
              <Input
                id="attachment-search-name"
                v-model="filters.originalName"
                maxlength="255"
                placeholder="搜索文件名"
              />
            </Field>
            <Field class="space-y-2">
              <FieldLabel for="attachment-search-module">业务模块</FieldLabel>
              <Input
                id="attachment-search-module"
                v-model="filters.businessModule"
                maxlength="64"
                placeholder="全部模块"
              />
            </Field>
            <Field class="space-y-2">
              <FieldLabel for="attachment-search-reference">引用状态</FieldLabel>
              <NativeSelect
                wrapper-class="w-full"
                id="attachment-search-reference"
                v-model="filters.referenceStatus"
                class="h-10 w-full"
              >
                <NativeSelectOption value="">全部</NativeSelectOption>
                <NativeSelectOption value="0">未引用</NativeSelectOption>
                <NativeSelectOption value="1">已引用</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Button type="submit" variant="outline">查询</Button>
          </FieldGroup>
        </form>

        <p v-if="actionMessage" role="status" class="text-sm text-muted-foreground">
          {{ actionMessage }}
        </p>
        <Alert variant="destructive" v-if="pageError"
          ><AlertDescription>
            <p>{{ pageError }}</p>
            <Button class="mt-3" size="sm" variant="outline" @click="loadRows">重试</Button>
          </AlertDescription></Alert
        >

        <div class="overflow-x-auto rounded-md border border-border">
          <Table class="w-full min-w-[850px] text-left">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">文件名</TableHead>
                <TableHead scope="col">MIME</TableHead>
                <TableHead scope="col">大小</TableHead>
                <TableHead scope="col">业务</TableHead>
                <TableHead scope="col">引用</TableHead>
                <TableHead scope="col">上传时间</TableHead>
                <TableHead scope="col" class="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow v-if="loading">
                <TableCell colspan="7" class="text-center">正在加载附件…</TableCell>
              </TableRow>
              <TableRow v-else-if="!pageError && rows.length === 0">
                <TableCell colspan="7" class="text-center">暂无附件</TableCell>
              </TableRow>
              <TableRow v-for="row in rows" :key="row.id">
                <TableCell class="max-w-64" :title="row.originalName">{{
                  row.originalName
                }}</TableCell>
                <TableCell>{{ row.mimeType }}</TableCell>
                <TableCell>{{ formatSize(row.fileSize) }}</TableCell>
                <TableCell
                  >{{ row.businessModule ?? "—"
                  }}<span v-if="row.businessRecordId">
                    / {{ row.businessRecordId }}</span
                  ></TableCell
                >
                <TableCell>
                  <span
                    class="rounded-full px-2 py-1 text-xs"
                    :class="
                      row.referenceStatus === 1
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                    "
                  >
                    {{ row.referenceStatus === 1 ? "已引用" : "未引用" }}
                  </span>
                </TableCell>
                <TableCell>{{ new Date(row.uploadedAt).toLocaleString() }}</TableCell>
                <TableCell class="text-right">
                  <Button
                    v-if="row.mimeType.toLowerCase().startsWith('image/')"
                    size="sm"
                    variant="ghost"
                    @click="preview(row)"
                    >预览</Button
                  >
                  <Button size="sm" variant="ghost" @click="download(row)">下载</Button>
                  <Button
                    v-if="canDelete"
                    size="sm"
                    variant="ghost"
                    class="text-destructive hover:text-destructive"
                    @click="remove(row)"
                    >删除</Button
                  >
                </TableCell>
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
      :open="Boolean(previewUrl)"
      @update:open="
        (open) => {
          if (!open) revokePreview();
        }
      "
    >
      <DialogContent
        v-if="previewUrl"
        class="max-h-[90vh] sm:max-w-[90vw]"
        @close-auto-focus="restorePreviewFocus"
      >
        <DialogHeader class="mb-2 flex-row items-center justify-between gap-4">
          <div>
            <DialogTitle class="text-sm">{{ previewName }}</DialogTitle>
            <DialogDescription>附件图像预览</DialogDescription>
          </div>
          <DialogClose as-child><Button size="sm" variant="outline">关闭</Button></DialogClose>
        </DialogHeader>
        <img
          class="max-h-[78vh] max-w-[85vw] object-contain"
          :src="previewUrl"
          :alt="previewName"
        />
      </DialogContent>
    </Dialog>
  </main>
</template>
