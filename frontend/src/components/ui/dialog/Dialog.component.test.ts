import { afterEach, describe, expect, it } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "./index";

import { useDialogReturnFocus } from "@/composables/use-dialog-return-focus";

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

const settle = async () => {
  await flushPromises();
  await new Promise(resolve => setTimeout(resolve, 30));
  await nextTick();
};

function setup() {
  wrapper = mount(defineComponent({
    components: {
      UiDialog: Dialog,
      DialogClose,
      DialogContent,
      DialogDescription,
      DialogHeader,
      DialogTitle,
      DialogTrigger
    },
    setup() {
      const open = ref(false);
      return { open };
    },
    template: `<button id="outside">背景</button>
      <UiDialog v-model:open="open">
        <DialogTrigger as-child><button id="opener">打开</button></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑记录</DialogTitle>
            <DialogDescription>编辑当前记录。</DialogDescription>
          </DialogHeader>
          <input id="first" aria-label="名称" />
          <DialogClose as-child><button id="last" type="button">取消</button></DialogClose>
        </DialogContent>
      </UiDialog>`
  }), { attachTo: document.body });
  return document.getElementById("opener") as HTMLButtonElement;
}

describe("shadcn-vue Dialog keyboard and focus behavior", () => {
  it("focuses content, traps focus and restores the trigger after Escape", async () => {
    const opener = setup();
    opener.focus();
    opener.click();
    await settle();

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.activeElement?.id).toBe("first");

    document.getElementById("outside")!.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);

    const closeButtons = dialog.querySelectorAll<HTMLElement>('[data-slot="dialog-close"]');
    const defaultClose = closeButtons[closeButtons.length - 1]!;
    defaultClose.focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    defaultClose.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true
    }));
    expect(document.activeElement?.id).toBe("first");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true
    }));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("restores trigger focus when the DialogClose button closes it", async () => {
    const opener = setup();
    opener.focus();
    opener.click();
    await settle();
    document.getElementById("last")!.click();
    await settle();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("restores focus to the exact button that opened a shared Dialog", async () => {
    wrapper = mount(defineComponent({
      components: {
        UiDialog: Dialog,
        DialogClose,
        DialogContent,
        DialogHeader,
        DialogTitle
      },
      setup() {
        const open = ref(false);
        const { restore: restoreFocus } = useDialogReturnFocus(open);
        return { open, restoreFocus };
      },
      template: `<button id="first-trigger" @click="open = true">First</button>
        <button id="second-trigger" @click="open = true">Second</button>
        <UiDialog v-model:open="open">
          <DialogContent @close-auto-focus="restoreFocus">
            <DialogHeader><DialogTitle>Shared dialog</DialogTitle></DialogHeader>
            <DialogClose as-child><button id="close-shared" type="button">Close</button></DialogClose>
          </DialogContent>
        </UiDialog>`
    }), { attachTo: document.body });

    const closeAndCheck = async (triggerId: string) => {
      const trigger = document.getElementById(triggerId)!;
      trigger.focus();
      trigger.click();
      await settle();
      document.getElementById("close-shared")!.click();
      await settle();
      expect(document.activeElement).toBe(trigger);
    };

    await closeAndCheck("first-trigger");
    await closeAndCheck("second-trigger");
    expect(document.activeElement?.id).toBe("second-trigger");
  });
});
