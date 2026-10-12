import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";
import { requestConfirmation } from "@/composables/use-confirmation";
import { ATTACHMENT_ACCEPT } from "@template/contracts/attachments";
import { unrefElement } from "@vueuse/core";
import { computed, onMounted, onUnmounted, reactive, ref, type ComponentPublicInstance } from "vue";
import { AttachmentListRequestSchema, type Attachment } from "@template/contracts";
import {
  deleteAttachment,
  downloadAttachment,
  getAttachments,
  uploadAttachment
} from "@/features/attachments/attachments.service";
import { usePermissionStoreHook } from "@/stores/modules/permission";

export function useAttachmentsPage() {
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
  const selectedFile = ref<ComponentPublicInstance | null>(null);
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
  return {
    ATTACHMENT_ACCEPT,
    PAGE_SIZE,
    permissions,
    canUpload,
    canDelete,
    loading,
    uploading,
    rows,
    total,
    page,
    pageCount,
    pageError,
    actionMessage,
    selectedFile,
    previewUrl,
    previewName,
    capturePreviewFocus,
    restorePreviewFocus,
    filters,
    uploadForm,
    errorText,
    formatSize,
    revokePreview,
    loadRows,
    search,
    chooseFile,
    uploadSelectedFile,
    saveBlob,
    download,
    preview,
    remove,
    changePage
  };
}
