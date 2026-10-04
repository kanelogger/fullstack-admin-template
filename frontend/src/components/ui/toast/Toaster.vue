<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import {
  toastClearEventName,
  toastCloseEventName,
  toastEventName,
  type ToastPayload
} from "@/utils/message";

const toasts = ref<ToastPayload[]>([]);
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function dismiss(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  toasts.value = toasts.value.filter(toast => toast.id !== id);
}

function onToast(event: Event) {
  const toast = (event as CustomEvent<ToastPayload>).detail;
  toasts.value = [...toasts.value.filter(item => item.id !== toast.id), toast].slice(-4);
  if (toast.duration > 0) {
    timers.set(toast.id, setTimeout(() => dismiss(toast.id), toast.duration));
  }
}

function onClose(event: Event) {
  const id = (event as CustomEvent<number>).detail;
  dismiss(id);
}

function onClear() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  toasts.value = [];
}

onMounted(() => {
  window.addEventListener(toastEventName, onToast);
  window.addEventListener(toastCloseEventName, onClose);
  window.addEventListener(toastClearEventName, onClear);
});

onUnmounted(() => {
  window.removeEventListener(toastEventName, onToast);
  window.removeEventListener(toastCloseEventName, onClose);
  window.removeEventListener(toastClearEventName, onClear);
  onClear();
});
</script>

<template>
  <TransitionGroup
    tag="ol"
    name="toast"
    class="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    aria-label="通知"
  >
    <li
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
      :class="{
        'border-emerald-500/40': toast.type === 'success',
        'border-destructive/50': toast.type === 'error',
        'border-amber-500/50': toast.type === 'warning',
        'border-border': toast.type === 'info'
      }"
      :role="toast.type === 'error' ? 'alert' : 'status'"
      :aria-live="toast.type === 'error' ? 'assertive' : 'polite'"
    >
      <span
        class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-semibold"
        :class="{
          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300': toast.type === 'success',
          'bg-destructive/10 text-destructive': toast.type === 'error',
          'bg-amber-500/15 text-amber-700 dark:text-amber-300': toast.type === 'warning',
          'bg-primary/10 text-primary': toast.type === 'info'
        }"
        aria-hidden="true"
      >{{ toast.type === "success" ? "✓" : toast.type === "error" || toast.type === "warning" ? "!" : "i" }}</span>
      <p class="min-w-0 flex-1 break-words">{{ toast.text }}</p>
      <button
        v-if="toast.showClose"
        type="button"
        class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="关闭通知"
        @click="dismiss(toast.id)"
      >×</button>
    </li>
  </TransitionGroup>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active,
.toast-move {
  transition: opacity 160ms ease, transform 160ms ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-0.35rem);
}
.toast-leave-active {
  position: absolute;
}
</style>
