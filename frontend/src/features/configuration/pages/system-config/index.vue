<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SystemConfig } from "@template/contracts/system-config";
import {
  listSystemConfigurations,
  saveSystemConfiguration,
  softDeleteSystemConfiguration
} from "@/features/configuration/configuration.service";
import { usePermissionStoreHook } from "@/stores/modules/permission";

defineOptions({ name: "SystemConfig" });

type StatusFilter = "all" | "0" | "1";
type EditorMode = "create" | "edit";

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
  if (!window.confirm(`确认删除配置“${config.configName}”？`)) return;
  actionError.value = "";
  try {
    await softDeleteSystemConfiguration(config.id);
    await loadConfigurations();
  } catch (error) {
    actionError.value = errorText(error, "配置删除失败。");
  }
}

onMounted(loadConfigurations);
</script>

<template>
  <main class="space-y-4 p-4" data-testid="system-configuration">
    <Card>
      <CardHeader class="flex flex-wrap items-center justify-between gap-3">
        <CardTitle>系统配置</CardTitle>
        <Button v-if="canUpdate" data-testid="create-system-config" @click="openCreate">新增配置</Button>
      </CardHeader>
      <CardContent class="space-y-4">
        <form class="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_auto]" @submit.prevent="search">
          <div class="space-y-1.5"><Label for="config-code-filter">配置编码</Label><Input id="config-code-filter" v-model="codeFilter" placeholder="按编码筛选" /></div>
          <div class="space-y-1.5"><Label for="config-name-filter">配置名称</Label><Input id="config-name-filter" v-model="nameFilter" placeholder="按名称筛选" /></div>
          <div class="space-y-1.5"><Label for="config-status-filter">状态</Label><select id="config-status-filter" v-model="statusFilter" class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option value="all">全部</option><option value="1">启用</option><option value="0">停用</option></select></div>
          <div class="flex items-end"><Button type="submit" variant="outline">筛选</Button></div>
        </form>
        <p v-if="actionError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{{ actionError }}</p>
        <p v-if="loadError" role="alert" class="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{{ loadError }}</p>
        <div v-if="loading" role="status" class="py-8 text-center text-sm text-muted-foreground">正在加载配置…</div>
        <div v-else-if="loadError" class="py-5 text-center"><Button variant="outline" @click="loadConfigurations">重试</Button></div>
        <div v-else-if="!rows.length" class="py-8 text-center text-sm text-muted-foreground">暂无系统配置</div>
        <div v-else class="overflow-x-auto rounded-md border">
          <table class="w-full min-w-[1000px] text-left text-sm">
            <thead class="bg-muted/50 text-muted-foreground"><tr><th class="px-3 py-2 font-medium">配置编码</th><th class="px-3 py-2 font-medium">配置名称</th><th class="px-3 py-2 font-medium">配置值</th><th class="px-3 py-2 font-medium">类型</th><th class="px-3 py-2 font-medium">状态</th><th class="px-3 py-2 font-medium">说明</th><th class="px-3 py-2 font-medium">操作</th></tr></thead>
            <tbody><tr v-for="config in rows" :key="config.id" class="border-t">
              <td class="px-3 py-3 font-mono text-xs">{{ config.configCode }}</td>
              <td class="px-3 py-3 font-medium">{{ config.configName }}</td>
              <td class="max-w-sm px-3 py-3"><span class="block max-w-[22rem] truncate font-mono text-xs" :title="config.configValue">{{ config.configValue }}</span></td>
              <td class="px-3 py-3">{{ config.valueType }}</td>
              <td class="px-3 py-3"><Badge :variant="config.status === 1 ? 'default' : 'secondary'">{{ config.status === 1 ? "启用" : "停用" }}</Badge></td>
              <td class="px-3 py-3">{{ config.description || "—" }}</td>
              <td class="px-3 py-3"><div v-if="canUpdate" class="flex gap-1"><Button size="sm" variant="outline" @click="openEdit(config)">编辑</Button><Button size="sm" variant="ghost" @click="toggleStatus(config)">{{ config.status === 1 ? "停用" : "启用" }}</Button><Button size="sm" variant="ghost" class="text-destructive" @click="removeConfig(config)">删除</Button></div><span v-else class="text-xs text-muted-foreground">只读</span></td>
            </tr></tbody>
          </table>
        </div>
        <div v-if="total > pageSize" class="flex items-center justify-end gap-3 text-sm"><span class="text-muted-foreground">共 {{ total }} 条</span><Button size="sm" variant="outline" :disabled="page <= 1" @click="page--; loadConfigurations()">上一页</Button><span>第 {{ page }} / {{ pageCount }} 页</span><Button size="sm" variant="outline" :disabled="page >= pageCount" @click="page++; loadConfigurations()">下一页</Button><select v-model.number="pageSize" aria-label="每页配置数" class="h-8 rounded-md border bg-background px-2" @change="page = 1; loadConfigurations()"><option :value="10">10 条</option><option :value="20">20 条</option><option :value="50">50 条</option></select></div>
      </CardContent>
    </Card>

    <div v-if="editorOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="editorOpen = false">
      <section role="dialog" aria-modal="true" aria-labelledby="config-editor-title" class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-5 shadow-lg"><h2 id="config-editor-title" class="text-lg font-semibold">{{ editorMode === "create" ? "新增配置" : "编辑配置" }}</h2>
        <form class="mt-4 grid gap-4 sm:grid-cols-2" @submit.prevent="saveConfig">
          <div class="space-y-1.5"><Label for="config-code">配置编码</Label><Input id="config-code" v-model="form.configCode" required maxlength="64" /></div>
          <div class="space-y-1.5"><Label for="config-name">配置名称</Label><Input id="config-name" v-model="form.configName" required maxlength="128" /></div>
          <div class="space-y-1.5"><Label for="config-value-type">值类型</Label><select id="config-value-type" v-model="form.valueType" class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option v-for="type in valueTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></div>
          <div class="space-y-1.5"><Label for="config-status">状态</Label><select id="config-status" v-model.number="form.status" class="h-9 w-full rounded-md border bg-background px-3 text-sm"><option :value="1">启用</option><option :value="0">停用</option></select></div>
          <div class="space-y-1.5 sm:col-span-2"><Label for="config-value">配置值</Label><textarea id="config-value" v-model="form.configValue" required rows="4" class="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm" /><p class="text-xs text-muted-foreground">此页面维护旧业务系统配置值；部署密钥、服务凭据应留在本机或服务端密钥配置中。</p></div>
          <div class="space-y-1.5 sm:col-span-2"><Label for="config-description">说明</Label><textarea id="config-description" v-model="form.description" rows="2" maxlength="255" class="w-full rounded-md border bg-background px-3 py-2 text-sm" /></div>
          <p v-if="actionError" role="alert" class="text-sm text-destructive sm:col-span-2">{{ actionError }}</p>
          <div class="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" @click="editorOpen = false">取消</Button><Button type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存" }}</Button></div>
        </form>
      </section>
    </div>
  </main>
</template>
