import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => ({ rpc: mocks.rpc }) }));

import { saveSystemConfiguration, softDeleteSystemConfiguration } from "./configuration.service";

const configId = "9007199254740993";
const now = "2026-10-07T02:00:00.000Z";

describe("configuration service", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("normalizes configuration value types and saves using exact text IDs", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: configId,
        configCode: "UI_THEME",
        configName: "界面主题",
        configValue: "dark",
        valueType: "STRING",
        status: 1,
        description: null,
        createdAt: now,
        updatedAt: now
      },
      error: null
    });

    const result = await saveSystemConfiguration({
      id: configId,
      configCode: "UI_THEME",
      configName: "界面主题",
      configValue: "dark",
      valueType: "string",
      status: 1,
      description: null
    });

    expect(result.id).toBe(configId);
    expect(mocks.rpc).toHaveBeenCalledWith("save_system_configuration", {
      p_id: configId,
      p_config_code: "UI_THEME",
      p_config_name: "界面主题",
      p_config_value: "dark",
      p_value_type: "STRING",
      p_status: 1,
      p_description: null
    });
  });

  it("soft deletes by a decimal string key", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await softDeleteSystemConfiguration(configId);

    expect(mocks.rpc).toHaveBeenCalledWith("soft_delete_system_configuration", { p_id: configId });
  });
});
