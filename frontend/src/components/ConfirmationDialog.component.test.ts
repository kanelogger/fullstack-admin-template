import { afterEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { confirmation, requestConfirmation } from "@/composables/use-confirmation";

const mocked = vi.hoisted(() => ({
  route: { fullPath: "/users" },
  session: { authUserId: "actor", authSessionId: "session-a" }
}));
vi.mock("vue-router", () => ({ useRoute: () => mocked.route }));
vi.mock("@/stores/modules/session", () => ({ useSessionStoreHook: () => mocked.session }));
import ConfirmationDialog from "./ConfirmationDialog.vue";
let wrapper: VueWrapper | undefined;
const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 30));
};
afterEach(() => {
  wrapper?.unmount();
  confirmation.cancel();
  document.body.innerHTML = "";
});

describe("shared AlertDialog confirmation", () => {
  it("Escape rejects the pending action and restores the calling button", async () => {
    wrapper = mount(ConfirmationDialog, { attachTo: document.body });
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const action = requestConfirmation("删除部门？");
    await settle();
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("删除部门？");
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    );
    await expect(action).resolves.toBe(false);
    await settle();
    expect(document.activeElement).toBe(button);
  });

  it("authorizes an action when the actual AlertDialog action button is clicked", async () => {
    wrapper = mount(ConfirmationDialog, { attachTo: document.body });
    const action = requestConfirmation("删除记录？");
    await settle();
    const buttons = document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button');
    buttons[buttons.length - 1]!.click();
    await expect(action).resolves.toBe(true);
  });

  it("cancels the pending action when its Session changes", async () => {
    mocked.session = reactive({ authUserId: "actor", authSessionId: "session-a" });
    wrapper = mount(ConfirmationDialog, { attachTo: document.body });
    const action = requestConfirmation("重置密码？");
    await settle();
    mocked.session.authSessionId = "session-b";
    await expect(action).resolves.toBe(false);
  });
});
