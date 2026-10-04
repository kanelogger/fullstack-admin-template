import { storageLocal } from "@/utils/shared";

export interface CachedUserInfo {
  userId: string;
  authUserId: string;
  avatar: string;
  username: string;
  nickname: string;
  roles: string[];
  permissions: string[];
}

export const userKey = "user-info";

export function cacheUserInfo(value: CachedUserInfo): void {
  storageLocal().setItem(userKey, value);
}

export function getCachedUserInfo(): CachedUserInfo | null {
  return storageLocal().getItem<CachedUserInfo>(userKey);
}

export function clearCachedUserInfo(): void {
  storageLocal().removeItem(userKey);
}
