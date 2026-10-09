<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { useRoute } from "vue-router";
import { useSessionStoreHook } from "@/stores/modules/session";
import {
  confirmation,
  confirmationMessage,
  confirmationReturnFocus
} from "@/composables/use-confirmation";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from "@/components/ui/alert-dialog";

const route = useRoute();
const session = useSessionStoreHook();
function cancel() {
  if (confirmation.isRevealed.value) confirmation.cancel();
}
watch(() => [route.fullPath, session.authUserId, session.authSessionId], cancel, { flush: "sync" });
onBeforeUnmount(cancel);
function restoreFocus(event: Event) {
  event.preventDefault();
  if (confirmationReturnFocus.value?.isConnected) confirmationReturnFocus.value.focus();
}
</script>

<template>
  <AlertDialog
    :open="confirmation.isRevealed.value"
    @update:open="
      (open) => {
        if (!open) cancel();
      }
    "
  >
    <AlertDialogContent @close-auto-focus="restoreFocus">
      <AlertDialogHeader>
        <AlertDialogTitle>确认操作</AlertDialogTitle>
        <AlertDialogDescription>{{ confirmationMessage }}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click.capture="confirmation.cancel()">取消</AlertDialogCancel>
        <AlertDialogAction @click.capture="confirmation.confirm()">确认</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
