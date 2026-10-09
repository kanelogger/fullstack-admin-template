import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/features/users/users.service", () => ({
  listManagedUsers: mocks.list,
  getManagedUserRoles: vi.fn(),
  createManagedUser: vi.fn(),
  deleteManagedUser: vi.fn(),
  sendManagedUserPasswordReset: vi.fn(),
  setManagedUserActive: vi.fn(),
  updateManagedUser: vi.fn()
}));
vi.mock("@/stores/modules/permission", () => ({
  usePermissionStoreHook: () => ({ permissionKeys: new Set(["administration.users.read"]) })
}));
vi.mock("@/stores/modules/session", () => ({ useSessionStoreHook: () => ({ userId: "1" }) }));
import UsersPage from "./index.vue";

let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  mocks.list.mockReset();
});

describe("user list status rows", () => {
  it("keeps a spacious, subdued status row while loading and when no records match", async () => {
    let finish: (page: { items: []; total: number; page: number; pageSize: number }) => void;
    mocks.list.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    wrapper = mount(UsersPage);
    await flushPromises();
    const loading = wrapper.get('tbody [role="status"]');
    expect(loading.text()).toBe("正在加载用户…");
    expect(loading.element.closest("td")?.classList.contains("py-12")).toBe(true);
    expect(loading.element.closest("td")?.classList.contains("text-muted-foreground")).toBe(true);

    finish!({ items: [], total: 0, page: 1, pageSize: 10 });
    await flushPromises();
    const empty = wrapper.get('tbody [role="status"]');
    expect(empty.text()).toBe("没有匹配的用户");
    expect(empty.element.closest("td")?.classList.contains("py-12")).toBe(true);
    expect(empty.element.closest("td")?.classList.contains("text-muted-foreground")).toBe(true);
  });
});
