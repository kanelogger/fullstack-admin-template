import { defineStore } from "pinia";
import { store } from "../utils";

let stopMessageSubscription: (() => void) | undefined;
let subscribedReceiverId: string | undefined;

export const useNotificationStore = defineStore("notification", {
  state: () => ({
    unreadMessageCount: 0,
    messageRevision: 0,
    loadError: ""
  }),
  actions: {
    async refreshUnreadMessageCount() {
      try {
        const { getUnreadMessageCount } = await import(
          "@/features/messages/messages.service"
        );
        this.unreadMessageCount = await getUnreadMessageCount();
        this.loadError = "";
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : "未读消息加载失败";
      }
    },
    async startMessageUpdates() {
      let receiverId: string;
      let messageService: typeof import("@/features/messages/messages.service");
      try {
        messageService = await import("@/features/messages/messages.service");
        receiverId = await messageService.getCurrentMessageReceiverId();
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : "消息订阅初始化失败";
        return;
      }

      if (stopMessageSubscription && subscribedReceiverId === receiverId) {
        await this.refreshUnreadMessageCount();
        return;
      }

      stopMessageSubscription?.();
      subscribedReceiverId = receiverId;
      stopMessageSubscription = messageService.subscribeToMessageChanges(
        receiverId,
        () => {
          this.messageRevision += 1;
          void this.refreshUnreadMessageCount();
        },
        (status, detail) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            this.loadError = detail ?? "消息实时连接暂不可用";
          }
        }
      );
      await this.refreshUnreadMessageCount();
    },
    stopMessageUpdates() {
      stopMessageSubscription?.();
      stopMessageSubscription = undefined;
      subscribedReceiverId = undefined;
    },
    reset() {
      this.stopMessageUpdates();
      this.unreadMessageCount = 0;
      this.messageRevision = 0;
      this.loadError = "";
    }
  }
});

export function useNotificationStoreHook() {
  return useNotificationStore(store);
}
