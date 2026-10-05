import { describe, expect, it } from "vitest";
import {
  SaveSystemConfigRequestSchema,
  SystemConfigListRequestSchema,
  SystemConfigSchema,
  SystemConfigValueSchema
} from "@template/contracts/system-config";

describe("system configuration contracts", () => {
  it("preserves large configuration IDs and legacy typed values", () => {
    const config = {
      id: "9007199254740993",
      configCode: "UPLOAD_MAX_SIZE_MB",
      configName: "单文件最大 MB",
      configValue: "10",
      valueType: "NUMBER",
      status: 1,
      description: null,
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z"
    };
    expect(SystemConfigSchema.parse(config)).toEqual(config);
    expect(SystemConfigSchema.safeParse({ ...config, id: 9007199254740993 }).success).toBe(false);
    expect(SystemConfigValueSchema.parse({
      configCode: config.configCode,
      configValue: "false",
      valueType: "BOOLEAN"
    }).valueType).toBe("BOOLEAN");
  });

  it("normalizes supported legacy value types and falls back unknown values to STRING", () => {
    expect(SaveSystemConfigRequestSchema.parse({
      configCode: "FEATURE_FLAG",
      configName: "功能开关",
      configValue: "true",
      valueType: " boolean "
    }).valueType).toBe("BOOLEAN");
    expect(SaveSystemConfigRequestSchema.parse({
      configCode: "LEGACY_VALUE",
      configName: "旧配置",
      configValue: "x",
      valueType: "UNSUPPORTED"
    }).valueType).toBe("STRING");
    expect(SystemConfigListRequestSchema.parse({ page: 1 })).toMatchObject({
      page: 1,
      pageSize: 20
    });
  });
});
