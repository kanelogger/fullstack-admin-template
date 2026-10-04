import { isString, isIncludeAllChildren } from "@/utils/shared";
import { useUserStoreHook } from "@/store/modules/user";
export { cacheUserInfo, clearCachedUserInfo, getCachedUserInfo, userKey } from "@/utils/user-info";

/** Whether the active, server-restored profile grants the requested permission. */
export const hasPerms = (value: string | string[]): boolean => {
  if (!value) return false;
  const { permissions, isAuthenticated } = useUserStoreHook();
  if (!isAuthenticated || !permissions) return false;
  if (permissions.length === 1 && permissions[0] === "*:*:*") return true;
  return isString(value)
    ? permissions.includes(value)
    : isIncludeAllChildren(value, permissions);
};
