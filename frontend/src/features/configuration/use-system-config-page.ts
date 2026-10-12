import { requestConfirmation } from "@/composables/use-confirmation";
import { computed, onMounted, reactive, ref } from "vue";
import type { SystemConfig } from "@template/contracts/system-config";
import {
  listSystemConfigurations,
  saveSystemConfiguration,
  softDeleteSystemConfiguration
} from "@/features/configuration/configuration.service";
import { usePermissionStoreHook } from "@/stores/modules/permission";

export type StatusFilter = "all" | "0" | "1";
export type EditorMode = "create" | "edit";

export function useSystemConfigPage() {
  const permissionSet = computed(() => new Set(usePermissionStoreHook().permissionKeys));
  const canUpdate = computed(() => permissionSet.value.has("configuration.system.update"));

  const rows = ref<SystemConfig[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const loadError = ref("");
  const actionError = ref("");
  const editorOpen = ref(false);
  const editorMode = ref<EditorMode>("create");
  const editingConfig = ref<SystemConfig | null>(null);
  const page = ref(1);
  const pageSize = ref(10);
  const total = ref(0);
  const codeFilter = ref("");
  const nameFilter = ref("");
  const statusFilter = ref<StatusFilter>("all");

  const valueTypes = [
    { value: "STRING", label: "字符串" },
    { value: "NUMBER", label: "数字" },
    { value: "BOOLEAN", label: "布尔" },
    { value: "JSON", label: "JSON" }
  ] as const;
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

  const form = reactive({
    configCode: "",
    configName: "",
    configValue: "",
    valueType: "STRING",
    status: 1 as 0 | 1,
    description: ""
  });

  function errorText(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function loadConfigurations() {
    loading.value = true;
    loadError.value = "";
    try {
      const result = await listSystemConfigurations({
        configCode: codeFilter.value.trim() || undefined,
        configName: nameFilter.value.trim() || undefined,
        status: statusFilter.value === "all" ? undefined : Number(statusFilter.value),
        page: page.value,
        pageSize: pageSize.value
      });
      rows.value = result.items;
      total.value = result.total;
      page.value = Math.min(page.value, pageCount.value);
    } catch (error) {
      rows.value = [];
      total.value = 0;
      loadError.value = errorText(error, "配置列表读取失败。");
    } finally {
      loading.value = false;
    }
  }

  async function search() {
    page.value = 1;
    await loadConfigurations();
  }

  function clearForm() {
    Object.assign(form, {
      configCode: "",
      configName: "",
      configValue: "",
      valueType: "STRING",
      status: 1,
      description: ""
    });
  }

  function openCreate() {
    editorMode.value = "create";
    editingConfig.value = null;
    clearForm();
    actionError.value = "";
    editorOpen.value = true;
  }

  function openEdit(config: SystemConfig) {
    editorMode.value = "edit";
    editingConfig.value = config;
    Object.assign(form, {
      configCode: config.configCode,
      configName: config.configName,
      configValue: config.configValue,
      valueType: config.valueType,
      status: config.status,
      description: config.description ?? ""
    });
    actionError.value = "";
    editorOpen.value = true;
  }

  async function saveConfig() {
    if (saving.value) return;
    saving.value = true;
    actionError.value = "";
    try {
      await saveSystemConfiguration({
        ...(editingConfig.value ? { id: editingConfig.value.id } : {}),
        configCode: form.configCode,
        configName: form.configName,
        configValue: form.configValue,
        valueType: form.valueType,
        status: form.status,
        description: form.description.trim() || null
      });
      if (editorMode.value === "create") page.value = 1;
      editorOpen.value = false;
      await loadConfigurations();
    } catch (error) {
      actionError.value = errorText(error, "配置保存失败。");
    } finally {
      saving.value = false;
    }
  }

  async function toggleStatus(config: SystemConfig) {
    actionError.value = "";
    try {
      await saveSystemConfiguration({
        id: config.id,
        configCode: config.configCode,
        configName: config.configName,
        configValue: config.configValue,
        valueType: config.valueType,
        status: config.status === 1 ? 0 : 1,
        description: config.description
      });
      await loadConfigurations();
    } catch (error) {
      actionError.value = errorText(error, "配置状态更新失败。");
    }
  }

  async function removeConfig(config: SystemConfig) {
    if (!(await requestConfirmation(`确认删除配置“${config.configName}”？`))) return;
    actionError.value = "";
    try {
      await softDeleteSystemConfiguration(config.id);
      await loadConfigurations();
    } catch (error) {
      actionError.value = errorText(error, "配置删除失败。");
    }
  }

  onMounted(loadConfigurations);
  return {
    permissionSet,
    canUpdate,
    rows,
    loading,
    saving,
    loadError,
    actionError,
    editorOpen,
    editorMode,
    editingConfig,
    page,
    pageSize,
    total,
    codeFilter,
    nameFilter,
    statusFilter,
    valueTypes,
    pageCount,
    form,
    errorText,
    loadConfigurations,
    search,
    clearForm,
    openCreate,
    openEdit,
    saveConfig,
    toggleStatus,
    removeConfig
  };
}
