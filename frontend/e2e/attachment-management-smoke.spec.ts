import { expect, test } from "@playwright/test";
import { installSupabaseSessionMock } from "./helpers/supabase-session";

const actorId = "910000000000003";
const actorAuthId = "6f9619ff-8b86-4011-b42d-00cf4fc964ff";
const now = "2026-10-02T10:00:00.000Z";

test("attachment management uses private Storage and permission-checked metadata", async ({ page }) => {
  let attachments = [{
    id: "9007199254740993",
    original_name: "项目截图.png",
    storage_path: `${actorId}/00000000-0000-4000-8000-000000000001.png`,
    mime_type: "image/png",
    file_ext: "png",
    file_size: 4,
    business_module: "PROJECT",
    business_record_id: "9007199254740994",
    reference_status: 1,
    upload_user_id: actorId,
    uploaded_at: now
  }];
  const operations: string[] = [];
  const browserErrors: string[] = [];

  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", entry => {
    if (entry.type() === "error") browserErrors.push(entry.text());
  });

  await installSupabaseSessionMock(page, {
    userId: actorId,
    authUserId: actorAuthId,
    loginName: "admin",
    displayName: "超级管理员",
    roles: ["SUPER_ADMIN"],
    permissions: [
      "files.attachments.read",
      "files.attachments.upload",
      "files.attachments.delete"
    ]
  });

  await page.route("**/rest/v1/rpc/current_navigation", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "10",
      parentId: null,
      kind: "route",
      routeKey: "operation.attachments",
      path: "/operation/attachments",
      title: "附件管理",
      icon: "Paperclip",
      sortOrder: 1,
      requiredPermissionKey: "files.attachments.read"
    }])
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
  await page.route("**/rest/v1/attachment_read_model**", async route => {
    const url = new URL(route.request().url());
    const nameFilter = url.searchParams.get("original_name") ?? "";
    const moduleFilter = url.searchParams.get("business_module") ?? "";
    const referenceFilter = url.searchParams.get("reference_status") ?? "";
    const idFilter = url.searchParams.get("id") ?? "";
    const filtered = attachments
      .filter(item => !idFilter || idFilter === `eq.${item.id}`)
      .filter(item => !nameFilter || item.original_name.toLowerCase().includes(nameFilter.replace(/^ilike\.%|%$/g, "").toLowerCase()))
      .filter(item => !moduleFilter || moduleFilter === `eq.${item.business_module}`)
      .filter(item => !referenceFilter || referenceFilter === `eq.${item.reference_status}`);
    return route.fulfill({
      status: 200,
      headers: {
        "content-range": `0-${Math.max(filtered.length - 1, 0)}/${filtered.length}`,
        "access-control-expose-headers": "content-range"
      },
      contentType: "application/json",
      body: JSON.stringify(filtered)
    });
  });
  await page.route("**/storage/v1/object/**", async route => {
    operations.push(`${route.request().method()} storage`);
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ Key: "created" }) });
    }
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from([137, 80, 78, 71]) });
    }
    if (route.request().method() === "DELETE") {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.fallback();
  });
  await page.route("**/rest/v1/rpc/create_attachment_metadata", async route => {
    const args = route.request().postDataJSON() as Record<string, unknown>;
    operations.push("create metadata");
    const saved = {
      id: "9007199254740995",
      original_name: String(args.p_original_name),
      storage_path: String(args.p_storage_path),
      mime_type: String(args.p_mime_type),
      file_ext: String(args.p_file_ext),
      file_size: Number(args.p_file_size),
      business_module: args.p_business_module,
      business_record_id: args.p_business_record_id,
      reference_status: args.p_business_module ? 1 : 0,
      upload_user_id: actorId,
      uploaded_at: now
    };
    attachments = [saved, ...attachments];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved) });
  });
  await page.route("**/rest/v1/rpc/attachment_storage_path_for_delete", async route => {
    operations.push("resolve delete path");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(attachments[0]?.storage_path ?? "")
    });
  });
  await page.route("**/rest/v1/rpc/delete_attachment_metadata", async route => {
    operations.push("delete metadata");
    const args = route.request().postDataJSON() as Record<string, unknown>;
    attachments = attachments.filter(item => item.id !== String(args.p_attachment_id));
    return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
  });

  page.on("dialog", dialog => dialog.accept());
  await page.goto("/#/operation/attachments");
  await expect(page.getByRole("heading", { name: "附件管理" })).toBeVisible();
  const firstAttachment = page.getByRole("row").filter({ hasText: "项目截图.png" });
  await expect(firstAttachment).toBeVisible();
  await expect(firstAttachment).toContainText("9007199254740994");

  await page.getByLabel("业务模块").first().fill("PROJECT");
  await page.getByLabel("业务记录 ID").fill("9007199254740996");
  await page.getByRole("button", { name: "选择文件并上传" }).click();
  await page.getByLabel("选择附件").setInputFiles({
    name: "新截图.png",
    mimeType: "image/png",
    buffer: Buffer.from([137, 80, 78, 71])
  });
  await expect(page.getByText("已上传 新截图.png")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "新截图.png" })).toContainText("9007199254740996");
  expect(operations).toContain("POST storage");
  expect(operations).toContain("create metadata");

  await page.getByRole("button", { name: "下载" }).first().click();
  await expect.poll(() => operations.filter(item => item === "GET storage").length).toBe(1);
  await page.getByRole("button", { name: "删除" }).first().click();
  await expect.poll(() => operations).toContain("resolve delete path");
  await expect.poll(() => operations).toContain("DELETE storage");
  await expect.poll(() => operations).toContain("delete metadata");
  expect(browserErrors).toEqual([]);
});
