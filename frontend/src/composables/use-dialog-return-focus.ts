import { toValue, watch, type MaybeRefOrGetter } from "vue";

/** Keep the actual opener for dialogs with row actions or asynchronous loading. */
export function useDialogReturnFocus(open?: MaybeRefOrGetter<boolean>) {
  let returnFocus: HTMLElement | null = null;

  function capture() {
    const activeElement = document.activeElement;
    returnFocus =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
  }

  if (open !== undefined) {
    watch(
      () => toValue(open),
      (value, previous) => {
        if (value && !previous) capture();
      },
      { flush: "sync" }
    );
  }

  function restore(event: Event) {
    const target = returnFocus;
    returnFocus = null;
    // Let Dialog's default restoration run if the original row was removed.
    if (!target?.isConnected) return;
    event.preventDefault();
    target.focus();
  }

  return { capture, restore };
}
