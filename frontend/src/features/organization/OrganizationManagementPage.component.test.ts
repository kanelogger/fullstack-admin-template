// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { Department, DepartmentPage, PostPage } from "@template/contracts/organization";

const organizationMocks = vi.hoisted(() => ({
  getDepartments: vi.fn(),
  getPosts: vi.fn(),
  listDepartmentOptions: vi.fn(),
  saveDepartment: vi.fn(),
  savePost: vi.fn(),
  deleteDepartment: vi.fn(),
  deletePost: vi.fn()
}));

vi.mock("./organization.service", () => organizationMocks);
vi.mock("@/stores/modules/permission", () => ({
  usePermissionStoreHook: () => ({
    permissionKeys: new Set([
      "organization.departments.read",
      "organization.departments.create",
      "organization.departments.update",
      "organization.departments.delete",
      "organization.posts.read",
      "organization.posts.create",
      "organization.posts.update",
      "organization.posts.delete"
    ])
  })
}));

import OrganizationManagementPage from "./OrganizationManagementPage.vue";

const timestamp = "2026-10-08T00:00:00.000Z";
const department = (id: string, deptCode: string, deptName: string, parentId: string | null): Department => ({
  id,
  parentId,
  deptCode,
  deptName,
  status: 1,
  description: null,
  createdAt: timestamp,
  updatedAt: timestamp
});
const pageOf = (items: Department[]): DepartmentPage => ({ items, total: items.length, page: 1, pageSize: 10 });
const emptyPosts: PostPage = { items: [], total: 0, page: 1, pageSize: 10 };

describe("OrganizationManagementPage component", () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    for (const mock of Object.values(organizationMocks)) mock.mockReset();
    organizationMocks.getDepartments.mockResolvedValue(pageOf([]));
    organizationMocks.listDepartmentOptions.mockResolvedValue([]);
    organizationMocks.getPosts.mockResolvedValue(emptyPosts);
    organizationMocks.saveDepartment.mockResolvedValue(department("3", "NEW", "新部门", null));
    organizationMocks.savePost.mockResolvedValue(undefined);
    organizationMocks.deleteDepartment.mockResolvedValue(undefined);
    organizationMocks.deletePost.mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("renders full department paths from caller-scoped parent IDs", async () => {
    const departments = [
      department("1", "HQ", "总部", null),
      department("2", "EAST", "华东区", "1"),
      department("3", "SH", "上海分部", "2")
    ];
    organizationMocks.getDepartments.mockResolvedValue(pageOf(departments));
    organizationMocks.listDepartmentOptions.mockResolvedValue(departments);

    wrapper = mount(OrganizationManagementPage, { props: { kind: "department" } });
    await flushPromises();

    expect(wrapper.text()).toContain("部门层级");
    expect(wrapper.get("tbody").text()).toContain("总部 / 华东区 / 上海分部");
    expect(organizationMocks.listDepartmentOptions).toHaveBeenCalledOnce();
  });

  it("saves the selected parent as a decimal string ID", async () => {
    organizationMocks.getDepartments.mockResolvedValue(pageOf([department("9007199254740993", "HQ", "总部", null)]));
    organizationMocks.listDepartmentOptions.mockResolvedValue([department("9007199254740993", "HQ", "总部", null)]);

    wrapper = mount(OrganizationManagementPage, { props: { kind: "department" } });
    await flushPromises();
    await wrapper.get('[data-testid="create-organization"]').trigger("click");
    await wrapper.get("#department-code").setValue("OPS-CHILD");
    await wrapper.get("#department-name").setValue("运营子部门");
    await wrapper.get("#department-parent").setValue("9007199254740993");
    await wrapper.get('[role="dialog"] form').trigger("submit");
    await flushPromises();

    expect(organizationMocks.saveDepartment).toHaveBeenCalledWith({
      status: 1,
      description: null,
      parentId: "9007199254740993",
      deptCode: "OPS-CHILD",
      deptName: "运营子部门"
    });
  });

  it("does not offer itself or descendants as a department parent", async () => {
    const departments = [
      department("1", "HQ", "总部", null),
      department("2", "EAST", "华东区", "1")
    ];
    organizationMocks.getDepartments.mockResolvedValue(pageOf(departments));
    organizationMocks.listDepartmentOptions.mockResolvedValue(departments);

    wrapper = mount(OrganizationManagementPage, { props: { kind: "department" } });
    await flushPromises();
    await wrapper.get("tbody tr").get("button").trigger("click");
    const selectableIds = wrapper.findAll("#department-parent option").map(option => (option.element as HTMLOptionElement).value);

    expect(selectableIds).toEqual([""]);
  });

  it("does not show department hierarchy controls on the posts page", async () => {
    wrapper = mount(OrganizationManagementPage, { props: { kind: "post" } });
    await flushPromises();

    expect(wrapper.text()).not.toContain("部门层级");
    expect(wrapper.find("#department-parent").exists()).toBe(false);
  });
});
