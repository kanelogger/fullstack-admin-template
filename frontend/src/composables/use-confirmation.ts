import { shallowRef } from "vue";
import { useConfirmDialog } from "@vueuse/core";

// VueUse owns the pending promise; AlertDialog owns modal behavior.
export const confirmation = useConfirmDialog<string, void, void>();
export const confirmationMessage = shallowRef("");
export const confirmationReturnFocus = shallowRef<HTMLElement | null>(null);

export async function requestConfirmation(message: string): Promise<boolean> {
  if (confirmation.isRevealed.value) confirmation.cancel();
  confirmationMessage.value = message;
  confirmationReturnFocus.value =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const result = await confirmation.reveal(message);
  return !result.isCanceled;
}
