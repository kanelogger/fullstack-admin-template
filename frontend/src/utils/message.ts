import { toast } from "vue-sonner";

export type MessageType = "info" | "success" | "warning" | "error";
export interface MessageParams {
  type?: MessageType;
  duration?: number;
  showClose?: boolean;
}
export interface MessageHandler {
  close(): void;
}

export function message(text: string, params: MessageParams = {}): MessageHandler {
  const id = toast[params.type ?? "info"](text, {
    duration: params.duration === 0 ? Infinity : (params.duration ?? 2400),
    closeButton: params.showClose ?? true
  });
  return { close: () => toast.dismiss(id) };
}

export function closeAllMessage(): void {
  toast.dismiss();
}
