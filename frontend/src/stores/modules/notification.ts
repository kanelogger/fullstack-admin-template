import { defineStore } from "pinia";
import { store } from "../utils";

let stopMessageSubscription: (() => void) | undefined;
let subscribedReceiverId: string | undefined;
let subscriptionRevision = 0;
let countRequestRevision = 0;

export const useNotificationStore = defineStore("notification", {
  state: () => ({
    unreadMessageCount: 0,
    messageRevision: 0,
    loadError: ""
  }),
  actions: {
    async refreshUnreadMessageCount(receiverId = subscribedReceiverId) {
      const requestRevision = ++countRequestRevision;
      const currentSubscriptionRevision = subscriptionRevision;
      if (!receiverId) {
        await this.startMessageUpdates();
        return;
      }
      try {
        const { getUnreadMessageCount } = await import(
          "@/features/messages/messages.service"
        );
        const count = await getUnreadMessageCount(receiverId);
        if (
          currentSubscriptionRevision === subscriptionRevision &&
          requestRevision === countRequestRevision &&
          subscribedReceiverId === receiverId
        ) {
          this.unreadMessageCount = count;
          this.loadError = "";
        }
      } catch (error) {
        if (
          currentSubscriptionRevision === subscriptionRevision &&
          requestRevision === countRequestRevision &&
          subscribedReceiverId === receiverId
        ) {
          this.loadError = error instanceof Error ? error.message : "未读消息加载失败";
        }
      }
    },
    async startMessageUpdates(expectedReceiverId?: string) {
      const startRevision = subscriptionRevision;
      let receiverId: string;
      let messageService: typeof import("@/features/messages/messages.service");
      try {
        messageService = await import("@/features/messages/messages.service");
        receiverId = await messageService.getCurrentMessageReceiverId();
      } catch (error) {
        if (startRevision === subscriptionRevision) {
          this.loadError = error instanceof Error ? error.message : "消息订阅初始化失败";
        }
        return;
      }
      if (startRevision !== subscriptionRevision) return;
      if (expectedReceiverId && receiverId !== expectedReceiverId) return;

      if (stopMessageSubscription && subscribedReceiverId === receiverId) {
        await this.refreshUnreadMessageCount(receiverId);
        return;
      }

      stopMessageSubscription?.();
      subscriptionRevision += 1;
      countRequestRevision += 1;
      const currentSubscriptionRevision = subscriptionRevision;
      subscribedReceiverId = receiverId;
      stopMessageSubscription = messageService.subscribeToMessageChanges(
        receiverId,
        () => {
          if (
            currentSubscriptionRevision !== subscriptionRevision ||
            subscribedReceiverId !== receiverId
          ) return;
          this.messageRevision += 1;
          void this.refreshUnreadMessageCount(receiverId);
        },
        (status, detail) => {
          if (
            currentSubscriptionRevision !== subscriptionRevision ||
            subscribedReceiverId !== receiverId
          ) return;
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            this.loadError = detail ?? "消息实时连接暂不可用";
          }
        }
      );
      await this.refreshUnreadMessageCount(receiverId);
    },
    stopMessageUpdates() {
      subscriptionRevision += 1;
      countRequestRevision += 1;
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
