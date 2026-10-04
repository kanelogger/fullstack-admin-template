import {
  DeleteSystemConfigRequestSchema,
  SaveSystemConfigRequestSchema,
  SystemConfigListPageSchema,
  SystemConfigListRequestSchema,
  SystemConfigSchema,
  SystemConfigValueSchema,
  type SystemConfig,
  type SystemConfigListPage,
  type SystemConfigValue
} from "@/contracts/system-config";
import { getSupabaseClient } from "@/shared/supabase/client";

function throwOnError(error: { message?: string } | null, fallback: string): void {
  if (error) throw new Error(error.message || fallback);
}

export async function listSystemConfigurations(input: unknown): Promise<SystemConfigListPage> {
  const request = SystemConfigListRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("admin_system_configurations", {
    p_config_code: request.configCode || null,
    p_config_name: request.configName || null,
    p_status: request.status ?? null,
    p_page: request.page,
    p_page_size: request.pageSize
  });
  throwOnError(error, "配置列表加载失败");
  return SystemConfigListPageSchema.parse(data);
}

export async function getSystemConfigurationValue(configCodeInput: unknown): Promise<SystemConfigValue> {
  const configCode = SaveSystemConfigRequestSchema.shape.configCode.parse(configCodeInput);
  const { data, error } = await getSupabaseClient().rpc("system_configuration_value", {
    p_config_code: configCode
  });
  throwOnError(error, "配置值读取失败");
  return SystemConfigValueSchema.parse(data);
}

export async function saveSystemConfiguration(input: unknown): Promise<SystemConfig> {
  const request = SaveSystemConfigRequestSchema.parse(input);
  const { data, error } = await getSupabaseClient().rpc("save_system_configuration", {
    p_id: request.id ?? null,
    p_config_code: request.configCode,
    p_config_name: request.configName,
    p_config_value: request.configValue,
    p_value_type: request.valueType,
    p_status: request.status,
    p_description: request.description
  });
  throwOnError(error, "配置保存失败");
  return SystemConfigSchema.parse(data);
}

export async function softDeleteSystemConfiguration(idInput: unknown): Promise<void> {
  const request = DeleteSystemConfigRequestSchema.parse({ id: idInput });
  const { error } = await getSupabaseClient().rpc("soft_delete_system_configuration", {
    p_id: request.id
  });
  throwOnError(error, "配置删除失败");
}
