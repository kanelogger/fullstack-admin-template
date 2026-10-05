import { isString, isIncludeAllChildren } from "@/utils/shared";
import { useSessionStoreHook } from "@/stores/modules/session";
import { usePermissionStoreHook } from "@/stores/modules/permission";

/** Whether the active, server-restored profile grants the requested permission. */
export const hasPerms = (value: string | string[]): boolean => {
  if (!value) return false;
  const { isAuthenticated } = useSessionStoreHook();
  const { permissionKeys } = usePermissionStoreHook();
  if (!isAuthenticated || !permissionKeys) return false;
  if (permissionKeys.length === 1 && permissionKeys[0] === "*:*:*") return true;
  return isString(value)
    ? permissionKeys.includes(value)
    : isIncludeAllChildren(value, permissionKeys);
};
