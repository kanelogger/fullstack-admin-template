// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { effectScope, ref } from "vue";
import { useDialogReturnFocus } from "./use-dialog-return-focus";

afterEach(() => {
  document.body.innerHTML = "";
});
function button() {
  const element = document.createElement("button");
  document.body.append(element);
  return element;
}

describe("dialog opener ownership", () => {
  it("captures before asynchronous loading and preserves that button after focus moves", async () => {
    const opener = button();
    const other = button();
    const focus = useDialogReturnFocus();
    opener.focus();
    focus.capture();
    await Promise.resolve();
    other.focus();
    const event = new Event("closeAutoFocus", { cancelable: true });
    focus.restore(event);
    expect(document.activeElement).toBe(opener);
    expect(event.defaultPrevented).toBe(true);
  });

  it("keeps separate ownership for two independent dialogs", () => {
    const first = button();
    const second = button();
    const scope = effectScope();
    scope.run(() => {
      const firstOpen = ref(false);
      const secondOpen = ref(false);
      const firstFocus = useDialogReturnFocus(firstOpen);
      const secondFocus = useDialogReturnFocus(secondOpen);
      first.focus();
      firstOpen.value = true;
      second.focus();
      secondOpen.value = true;
      firstFocus.restore(new Event("closeAutoFocus", { cancelable: true }));
      expect(document.activeElement).toBe(first);
      secondFocus.restore(new Event("closeAutoFocus", { cancelable: true }));
      expect(document.activeElement).toBe(second);
    });
    scope.stop();
  });

  it("leaves default library restoration available when the original row disappeared", () => {
    const opener = button();
    const focus = useDialogReturnFocus();
    opener.focus();
    focus.capture();
    opener.remove();
    const event = new Event("closeAutoFocus", { cancelable: true });
    focus.restore(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
