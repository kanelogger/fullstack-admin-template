import { describe, expect, it } from "vitest";
import {
  DepartmentListRequestSchema,
  DepartmentPageSchema,
  PostListRequestSchema,
  SaveDepartmentRequestSchema,
  SavePostRequestSchema
} from "@template/contracts/organization";
import { mapDepartmentRow, mapPostRow } from "./organization.service";

const timestamp = "2026-10-02T03:04:05.000Z";

describe("organization contracts and read-model mapping", () => {
  it("keeps department and post BIGINT IDs as exact decimal strings", () => {
    const department = mapDepartmentRow({
      id: "9223372036854775807",
      parent_id: "9007199254740993",
      dept_code: "HQ",
      dept_name: "总部",
      status: 1,
      description: null,
      created_at: timestamp,
      updated_at: timestamp
    });
    const post = mapPostRow({
      id: "9007199254740993",
      post_code: "OWNER",
      post_name: "负责人",
      status: 0,
      description: "历史岗位",
      created_at: timestamp,
      updated_at: timestamp
    });

    expect(department.id).toBe("9223372036854775807");
    expect(department.parentId).toBe("9007199254740993");
    expect(post.id).toBe("9007199254740993");
    expect(() => mapDepartmentRow({ id: Number("9007199254740993") })).toThrow();
    expect(() => mapPostRow({ id: "9223372036854775808" })).toThrow();
  });

  it("normalizes filters and enforces bounded pagination and status", () => {
    expect(
      DepartmentListRequestSchema.parse({ deptCode: "  AD ", deptName: " 管理 ", page: 2 })
    ).toEqual({ deptCode: "AD", deptName: "管理", status: undefined, page: 2, pageSize: 10 });
    expect(PostListRequestSchema.parse({ postName: "审核", pageSize: 100 })).toMatchObject({
      postName: "审核",
      page: 1,
      pageSize: 100
    });
    expect(DepartmentListRequestSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(PostListRequestSchema.safeParse({ status: 2 }).success).toBe(false);
  });

  it("validates save fields, nullable descriptions, and PostgreSQL IDs", () => {
    expect(
      SaveDepartmentRequestSchema.parse({ deptCode: " OPS ", deptName: " 运营部 ", description: "  " })
    ).toMatchObject({ deptCode: "OPS", deptName: "运营部", status: 1, description: null });
    expect(SaveDepartmentRequestSchema.parse({
      parentId: "9007199254740993",
      deptCode: "OPS-CHILD",
      deptName: "运营子部门"
    }).parentId).toBe("9007199254740993");
    expect(SaveDepartmentRequestSchema.safeParse({
      parentId: 42,
      deptCode: "OPS-CHILD",
      deptName: "运营子部门"
    }).success).toBe(false);
    expect(
      SavePostRequestSchema.parse({
        id: "9007199254740993",
        postCode: " AUDITOR ",
        postName: " 审核人员 ",
        status: 0,
        description: null
      })
    ).toMatchObject({ id: "9007199254740993", postCode: "AUDITOR", status: 0 });
    expect(SaveDepartmentRequestSchema.safeParse({
      deptCode: "",
      deptName: "空编码",
      status: 1,
      description: null
    }).success).toBe(false);
    expect(SavePostRequestSchema.safeParse({
      id: 42,
      postCode: "ADMIN",
      postName: "管理员",
      status: 1,
      description: null
    }).success).toBe(false);
  });

  it("rejects a database page whose identifier was already rounded to a number", () => {
    expect(
      DepartmentPageSchema.safeParse({
        items: [{
          id: Number("9007199254740993"),
          parentId: null,
          deptCode: "HQ",
          deptName: "总部",
          status: 1,
          description: null,
          createdAt: timestamp,
          updatedAt: timestamp
        }],
        total: 1,
        page: 1,
        pageSize: 10
      }).success
    ).toBe(false);
  });
});
