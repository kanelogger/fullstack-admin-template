export type MessageType = "info" | "success" | "warning" | "error";

export interface MessageParams {
  type?: MessageType;
  duration?: number;
  showClose?: boolean;
}

export interface MessageHandler {
  close(): void;
}

export interface ToastPayload {
  id: number;
  text: string;
  type: MessageType;
  duration: number;
  showClose: boolean;
}

export const toastEventName = "template:toast";
export const toastCloseEventName = "template:toast-close";
export const toastClearEventName = "template:toast-clear";

let toastId = 0;

function emit(name: string, detail?: unknown) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function message(text: string, params: MessageParams = {}): MessageHandler {
  const id = ++toastId;
  const payload: ToastPayload = {
    id,
    text,
    type: params.type ?? "info",
    duration: params.duration ?? 2400,
    showClose: params.showClose ?? true
  };
  emit(toastEventName, payload);
  return { close: () => emit(toastCloseEventName, id) };
}

export function closeAllMessage(): void {
  emit(toastClearEventName);
}
