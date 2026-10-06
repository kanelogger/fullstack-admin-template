import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  resetRouter: vi.fn()
}));

vi.mock("../utils", () => ({
  store: {},
  router: { currentRoute: { value: { path: "/dashboard" } }, replace: mocks.routerReplace },
  resetRouter: mocks.resetRouter,
  routerArrays: [],
  initRouter: vi.fn()
}));
vi.mock("@/router/utils", () => ({ getTopMenu: vi.fn() }));
vi.mock("./tabs", () => ({ useTabsStoreHook: () => ({ handleTags: vi.fn() }) }));
vi.mock("./permission", () => ({ usePermissionStoreHook: () => ({ clearAuthorization: vi.fn() }) }));
vi.mock("./notification", () => ({ useNotificationStoreHook: () => ({ reset: vi.fn() }) }));

import { useSessionStore } from "./session";

describe("session-scoped logout cleanup", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("ignores a failed login's cleanup after a newer Session owns the store", async () => {
    const sessionStore = useSessionStore();
    Object.assign(sessionStore, {
      isAuthenticated: true,
      authUserId: "11111111-1111-4111-8111-111111111111",
      authSessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    });

    const result = await sessionStore.logOut({
      authUserId: "11111111-1111-4111-8111-111111111111",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    });

    expect(result).toEqual({ serverSessionRevoked: false, ignored: true });
    expect(sessionStore.isAuthenticated).toBe(true);
    expect(sessionStore.authSessionId).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(mocks.resetRouter).not.toHaveBeenCalled();
    expect(mocks.routerReplace).not.toHaveBeenCalled();
  });
});
