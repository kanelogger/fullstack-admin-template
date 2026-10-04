import { expect, test } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const actorId = "910000000000001";
const actorAuthId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const now = "2026-10-02T10:00:00.000Z";

test("dictionary and configuration screens exercise CRUD and ordering with mocked Supabase RPCs", async ({ page }) => {
  let nextId = 9_007_199_254_740_993n;
  const newId = () => (nextId++).toString();
  let dictionaryTypes = [{
    id: "1",
    dictCode: "user_status",
    dictName: "用户状态",
    status: 1,
    description: "用户启用/停用状态",
    createdAt: now,
    updatedAt: now,
    deletedAt: null as string | null
  }];
  let dictionaryItems = [
    {
      id: "9007199254740994",
      dictTypeId: "1",
      itemValue: "0",
      itemLabel: "已停用",
      sortOrder: 0,
      status: 1,
      description: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null as string | null
    },
    {
      id: "9007199254740995",
      dictTypeId: "1",
      itemValue: "1",
      itemLabel: "已启用",
      sortOrder: 1,
      status: 1,
      description: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null as string | null
    }
  ];
  let configurations = [{
    id: "9007199254740996",
    configCode: "SYSTEM_NAME",
    configName: "系统名称",
    configValue: "PC Admin",
    valueType: "STRING",
    status: 1,
    description: "登录页和顶部栏展示",
    createdAt: now,
    updatedAt: now,
    deletedAt: null as string | null
  }];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  await installSupabaseSessionMock(page, {
    userId: actorId,
    authUserId: actorAuthId,
    loginName: "admin",
    displayName: "系统管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [
      "configuration.dictionaries.read",
      "configuration.dictionaries.create",
      "configuration.dictionaries.update",
      "configuration.dictionaries.delete",
      "configuration.system.read",
      "configuration.system.update"
    ]
  });

  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      {
        id: "10",
        parentId: null,
        kind: "group",
        routeKey: null,
        path: "/system",
        title: "系统管理",
        icon: "SetUp",
        sortOrder: 10,
        requiredPermissionKey: null
      },
      {
        id: "11",
        parentId: "10",
        kind: "route",
        routeKey: "administration.dictionaries",
        path: "/system/dicts",
        title: "数据字典",
        icon: "Collection",
        sortOrder: 6,
        requiredPermissionKey: "configuration.dictionaries.read"
      },
      {
        id: "12",
        parentId: "10",
        kind: "route",
        routeKey: "administration.configurations",
        path: "/system/configs",
        title: "系统配置",
        icon: "Tools",
        sortOrder: 5,
        requiredPermissionKey: "configuration.system.read"
      }
    ])
  }));
  await page.route("**/rest/v1/rpc/current_business_user_id", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(actorId)
  }));
  await page.route("**/rest/v1/messages**", route => route.fulfill({
    status: 200,
    headers: { "content-range": "*/0", "access-control-expose-headers": "content-range" },
    body: "[]"
  }));

  await page.route("**/rest/v1/rpc/admin_dictionary_types", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    const active = dictionaryTypes.filter(type => !type.deletedAt);
    const filtered = active
      .filter(type => !args.p_dict_code || type.dictCode.toLowerCase().includes(String(args.p_dict_code).toLowerCase()))
      .filter(type => !args.p_dict_name || type.dictName.toLowerCase().includes(String(args.p_dict_name).toLowerCase()))
      .filter(type => args.p_status == null || type.status === Number(args.p_status))
      .sort((a, b) => BigInt(b.id) > BigInt(a.id) ? 1 : -1);
    const page = Number(args.p_page ?? 1);
    const pageSize = Number(args.p_page_size ?? 20);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: filtered.slice((page - 1) * pageSize, page * pageSize).map(({ deletedAt: _deletedAt, ...type }) => type),
        total: filtered.length,
        page,
        pageSize
      })
    });
  });
  await page.route("**/rest/v1/rpc/admin_dictionary_items", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    const items = dictionaryItems
      .filter(item => !item.deletedAt && item.dictTypeId === String(args.p_dict_type_id))
      .sort((a, b) => a.sortOrder - b.sortOrder || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
      .map(({ deletedAt: _deletedAt, ...item }) => item);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(items) });
  });
  await page.route("**/rest/v1/rpc/save_dictionary_type", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ name: "save_dictionary_type", args });
    const old = dictionaryTypes.find(type => type.id === String(args.p_id));
    const saved = {
      id: old?.id ?? newId(),
      dictCode: String(args.p_dict_code),
      dictName: String(args.p_dict_name),
      status: Number(args.p_status),
      description: args.p_description as string | null,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null
    };
    dictionaryTypes = old
      ? dictionaryTypes.map(type => type.id === old.id ? saved : type)
      : [...dictionaryTypes, saved];
    const { deletedAt: _deletedAt, ...data } = saved;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.route("**/rest/v1/rpc/save_dictionary_item", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ name: "save_dictionary_item", args });
    const old = dictionaryItems.find(item => item.id === String(args.p_id));
    const saved = {
      id: old?.id ?? newId(),
      dictTypeId: String(args.p_dict_type_id),
      itemValue: String(args.p_item_value),
      itemLabel: String(args.p_item_label),
      sortOrder: Number(args.p_sort_order),
      status: Number(args.p_status),
      description: args.p_description as string | null,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null
    };
    dictionaryItems = old
      ? dictionaryItems.map(item => item.id === old.id ? saved : item)
      : [...dictionaryItems, saved];
    const { deletedAt: _deletedAt, ...data } = saved;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.route("**/rest/v1/rpc/replace_dictionary_item_order", async route => {
    const args = route.request().postDataJSON() as { p_dict_type_id: string; p_items: Array<{ id: string; sortOrder: number }> };
    calls.push({ name: "replace_dictionary_item_order", args });
    const orderMap = new Map(args.p_items.map(item => [item.id, item.sortOrder]));
    dictionaryItems = dictionaryItems.map(item => orderMap.has(item.id)
      ? { ...item, sortOrder: orderMap.get(item.id)! }
      : item);
    return route.fulfill({ status: 204 });
  });
  await page.route("**/rest/v1/rpc/soft_delete_dictionary_item", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ name: "soft_delete_dictionary_item", args });
    dictionaryItems = dictionaryItems.map(item => item.id === String(args.p_dict_item_id)
      ? { ...item, deletedAt: now }
      : item);
    return route.fulfill({ status: 204 });
  });
  await page.route("**/rest/v1/rpc/soft_delete_dictionary_type", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ name: "soft_delete_dictionary_type", args });
    dictionaryTypes = dictionaryTypes.map(type => type.id === String(args.p_dict_type_id)
      ? { ...type, deletedAt: now }
      : type);
    return route.fulfill({ status: 204 });
  });

  await page.route("**/rest/v1/rpc/admin_system_configurations", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    const filtered = configurations
      .filter(config => !config.deletedAt)
      .filter(config => !args.p_config_code || config.configCode.toLowerCase().includes(String(args.p_config_code).toLowerCase()))
      .filter(config => !args.p_config_name || config.configName.toLowerCase().includes(String(args.p_config_name).toLowerCase()))
      .filter(config => args.p_status == null || config.status === Number(args.p_status))
      .sort((a, b) => BigInt(b.id) > BigInt(a.id) ? 1 : -1);
    const pageNumber = Number(args.p_page ?? 1);
    const pageSize = Number(args.p_page_size ?? 20);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize).map(({ deletedAt: _deletedAt, ...config }) => config),
        total: filtered.length,
        page: pageNumber,
        pageSize
      })
    });
  });
  await page.route("**/rest/v1/rpc/save_system_configuration", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ name: "save_system_configuration", args });
    const old = configurations.find(config => config.id === String(args.p_id));
    const saved = {
      id: old?.id ?? newId(),
      configCode: String(args.p_config_code),
      configName: String(args.p_config_name),
      configValue: String(args.p_config_value),
      valueType: String(args.p_value_type),
      status: Number(args.p_status),
      description: args.p_description as string | null,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null
    };
    configurations = old
      ? configurations.map(config => config.id === old.id ? saved : config)
      : [...configurations, saved];
    const { deletedAt: _deletedAt, ...data } = saved;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.route("**/rest/v1/rpc/soft_delete_system_configuration", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    calls.push({ name: "soft_delete_system_configuration", args });
    configurations = configurations.map(config => config.id === String(args.p_id)
      ? { ...config, deletedAt: now }
      : config);
    return route.fulfill({ status: 204 });
  });

  page.on("dialog", dialog => dialog.accept());
  await page.goto("/#/system/dicts");
  await expect(page.getByRole("heading", { name: "数据字典" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "用户状态" })).toBeVisible();

  await page.getByLabel("已停用排序").fill("3");
  await page.getByRole("button", { name: "保存排序" }).click();
  await expect.poll(() => calls.some(call => call.name === "replace_dictionary_item_order")).toBe(true);
  expect(calls.find(call => call.name === "replace_dictionary_item_order")?.args).toMatchObject({
    p_dict_type_id: "1",
    p_items: expect.arrayContaining([{ id: "9007199254740994", sortOrder: 3 }])
  });

  await page.getByRole("button", { name: "新增字典项" }).click();
  const itemDialog = page.getByRole("dialog");
  await itemDialog.getByLabel("字典值").fill("2");
  await itemDialog.getByLabel("字典标签").fill("离职");
  await itemDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("离职", { exact: true })).toBeVisible();

  const itemRow = page.getByRole("row").filter({ hasText: "离职" });
  await itemRow.getByRole("button", { name: "编辑" }).click();
  const editItemDialog = page.getByRole("dialog");
  await editItemDialog.getByLabel("字典标签").fill("已离职");
  await editItemDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已离职", { exact: true })).toBeVisible();
  const editedItemRow = page.getByRole("row").filter({ hasText: "已离职" });
  await editedItemRow.getByRole("button", { name: "停用" }).click();
  await expect(editedItemRow.getByText("停用", { exact: true })).toBeVisible();
  await editedItemRow.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("已离职", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "新增类型" }).click();
  const typeDialog = page.getByRole("dialog");
  await typeDialog.getByLabel("字典编码").fill("ui_theme");
  await typeDialog.getByLabel("字典名称").fill("界面主题");
  await typeDialog.getByRole("button", { name: "保存", exact: true }).click();
  const newTypeRow = page.getByRole("row").filter({ hasText: "界面主题" });
  await expect(newTypeRow).toBeVisible();
  await newTypeRow.getByRole("button", { name: "编辑" }).click();
  const editTypeDialog = page.getByRole("dialog");
  await editTypeDialog.getByLabel("字典名称").fill("界面主题选项");
  await editTypeDialog.getByRole("button", { name: "保存", exact: true }).click();
  const updatedTypeRow = page.getByRole("row").filter({ hasText: "界面主题选项" });
  await expect(updatedTypeRow).toBeVisible();
  await updatedTypeRow.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("界面主题选项", { exact: true })).toHaveCount(0);

  await page.goto("/#/system/configs");
  await expect(page.getByRole("heading", { name: "系统配置" })).toBeVisible();
  await expect(page.getByText("PC Admin", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新增配置" }).click();
  const configDialog = page.getByRole("dialog");
  await configDialog.getByLabel("配置编码").fill("UI_THEME");
  await configDialog.getByLabel("配置名称").fill("界面主题");
  await configDialog.getByLabel("配置值").fill("dark");
  await configDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("dark", { exact: true })).toBeVisible();

  const configRow = page.getByRole("row").filter({ hasText: "UI_THEME" });
  await configRow.getByRole("button", { name: "编辑" }).click();
  const editConfigDialog = page.getByRole("dialog");
  await editConfigDialog.getByLabel("配置值").fill("light");
  await editConfigDialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("light", { exact: true })).toBeVisible();
  const updatedConfigRow = page.getByRole("row").filter({ hasText: "UI_THEME" });
  await updatedConfigRow.getByRole("button", { name: "停用" }).click();
  await expect(updatedConfigRow.getByText("停用", { exact: true })).toBeVisible();
  await updatedConfigRow.getByRole("button", { name: "启用" }).click();
  await expect(updatedConfigRow.getByText("启用", { exact: true })).toBeVisible();
  await updatedConfigRow.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("UI_THEME", { exact: true })).toHaveCount(0);

  expect(calls.map(call => call.name)).toEqual(expect.arrayContaining([
    "save_dictionary_type",
    "save_dictionary_item",
    "replace_dictionary_item_order",
    "soft_delete_dictionary_item",
    "soft_delete_dictionary_type",
    "save_system_configuration",
    "soft_delete_system_configuration"
  ]));
});
