import { describe, expect, it } from "vitest";
import {
  BusinessIdSchema,
  LoginRequestSchema,
  MarkMessagesReadRequestSchema,
  MessageDetailSchema,
  MessageListRequestSchema,
  MessageListItemSchema,
  MenuEntrySchema,
  PaginationRequestSchema,
  PermissionKeySchema,
  ProfileUpdateRequestSchema,
  SessionLoginResponseSchema,
  CreateManagedUserRequestSchema,
  ManagedUserSchema,
  UpdateManagedUserRequestSchema
} from "./index";

describe("shared contracts", () => {
  it("preserves PostgreSQL BIGINT identifiers as decimal strings", () => {
    expect(BusinessIdSchema.parse("9223372036854775807")).toBe(
      "9223372036854775807"
    );
    expect(BusinessIdSchema.safeParse("9223372036854775808").success).toBe(
      false
    );
    expect(BusinessIdSchema.safeParse(12).success).toBe(false);
  });

  it("normalizes login names and rejects empty credentials", () => {
    expect(
      LoginRequestSchema.parse({ loginName: " admin ", password: "secret" })
    ).toEqual({ loginName: "admin", password: "secret" });
    expect(
      LoginRequestSchema.safeParse({ loginName: "  ", password: "secret" })
        .success
    ).toBe(false);
  });

  it("accepts only stable three-part permission keys", () => {
    expect(PermissionKeySchema.safeParse("administration.users.read").success).toBe(
      true
    );
    expect(PermissionKeySchema.safeParse("*:*:*").success).toBe(false);
  });

  it("does not accept server-selected component paths in menu data", () => {
    const valid = {
      id: "1",
      parentId: null,
      kind: "route",
      routeKey: "administration.users",
      path: "/admin/users",
      title: "用户管理",
      icon: null,
      sortOrder: 1,
      requiredPermissionKey: "administration.users.read"
    };

    expect(MenuEntrySchema.safeParse(valid).success).toBe(true);
    expect(
      MenuEntrySchema.safeParse({ ...valid, componentPath: "../../unsafe.vue" })
        .success
    ).toBe(false);
  });

  it("caps page sizes", () => {
    expect(PaginationRequestSchema.parse({ page: 2 })).toEqual({
      page: 2,
      pageSize: 20
    });
    expect(PaginationRequestSchema.safeParse({ page: 1, pageSize: 101 }).success).toBe(
      false
    );
  });

  it("validates message filters, read state, and BIGINT message IDs", () => {
    expect(
      MessageListRequestSchema.parse({
        title: "  report ",
        readStatus: "unread",
        sentStartAt: "2026-10-01",
        page: 1
      })
    ).toMatchObject({ title: "report", readStatus: "unread", pageSize: 10 });
    expect(
      MessageListRequestSchema.safeParse({
        sentStartAt: "2026-10-02",
        sentEndAt: "2026-10-01"
      }).success
    ).toBe(false);
    expect(
      MessageListItemSchema.safeParse({
        id: "9223372036854775807",
        title: "Notice",
        messageType: "NOTICE",
        summary: null,
        readStatus: false,
        sentAt: "2026-10-01T00:00:00Z",
        readAt: null
      }).success
    ).toBe(true);
    expect(
      MessageDetailSchema.safeParse({
        id: 12,
        title: "Notice",
        messageType: "NOTICE",
        summary: null,
        readStatus: false,
        sentAt: "2026-10-01T00:00:00Z",
        readAt: null,
        content: "content",
        senderId: null
      }).success
    ).toBe(false);
    expect(MarkMessagesReadRequestSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(MarkMessagesReadRequestSchema.safeParse({ all: true }).success).toBe(true);
    expect(
      MessageListItemSchema.safeParse({
        id: "7",
        title: "Custom type",
        messageType: "CUSTOM_NOTICE",
        summary: null,
        readStatus: false,
        sentAt: "2026-10-01T00:00:00Z",
        readAt: null
      }).success
    ).toBe(true);
  });

  it("keeps managed-user and role identifiers as PostgreSQL BIGINT strings", () => {
    const user = {
      id: "9223372036854775807",
      userCode: "E-100",
      loginName: "employee-100",
      displayName: "员工一百",
      email: "user100@example.test",
      phone: null,
      departmentId: "9223372036854775806",
      postId: null,
      isActive: true,
      roles: [{ id: "9007199254740993", code: "COMMON_USER", name: "普通用户", isActive: true }],
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-02T00:00:00Z"
    };
    expect(ManagedUserSchema.parse(user)).toEqual(user);
    expect(ManagedUserSchema.safeParse({ ...user, id: 9007199254740993 }).success).toBe(false);
  });

  it("requires email only on account creation and never accepts an initial password", () => {
    const create = {
      userCode: "E-101",
      loginName: "employee-101",
      displayName: "员工一百零一",
      email: "user101@example.test",
      phone: null,
      departmentId: null,
      postId: null,
      roleIds: ["2"]
    };
    expect(CreateManagedUserRequestSchema.parse(create)).toEqual(create);
    expect(CreateManagedUserRequestSchema.safeParse({ ...create, password: "temporary" }).success).toBe(false);
    const { email, ...editable } = create;
    expect(email).toBe("user101@example.test");
    expect(UpdateManagedUserRequestSchema.parse({ id: "9", ...editable })).toMatchObject({
      id: "9",
      userCode: "E-101",
      roleIds: ["2"]
    });
  });

  it("accepts only self-service profile fields", () => {
    expect(
      ProfileUpdateRequestSchema.parse({ displayName: "  Kane ", phone: "  " })
    ).toEqual({ displayName: "Kane", phone: null });
    expect(
      ProfileUpdateRequestSchema.safeParse({
        displayName: "Kane",
        phone: null,
        email: "changed@example.com"
      }).success
    ).toBe(false);
  });

  it("keeps Supabase credentials separate from the safe session profile", () => {
    const response = {
      success: true,
      data: {
        session: {
          profile: {
            id: "9007199254740993",
            authUserId: "6f9619ff-8b86-4011-b42d-00cf4fc964ff",
            loginName: "operator",
            displayName: "运营人员",
            email: "operator@example.com",
            phone: null,
            avatarUrl: null,
            isActive: true
          },
          roleCodes: ["OPERATOR"],
          permissionKeys: ["communication.messages.read"],
          mustResetPassword: false
        },
        tokens: {
          accessToken: "access-token",
          refreshToken: "refresh-token",
          expiresAt: 1_800_000_000
        }
      }
    };

    expect(SessionLoginResponseSchema.safeParse(response).success).toBe(true);
    expect(
      SessionLoginResponseSchema.safeParse({
        ...response,
        data: { ...response.data, session: { ...response.data.session, accessToken: "wrong-layer" } }
      }).success
    ).toBe(false);
  });
});
