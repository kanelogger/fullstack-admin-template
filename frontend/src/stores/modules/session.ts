import { defineStore } from "pinia";
import { store, router, resetRouter, routerArrays, initRouter } from "../utils";
import { getTopMenu } from "@/router/utils";
import { invalidateAuthOperations, isCurrentAuthOperation } from "@/features/auth/session-generation";
import { isAuthError } from "@supabase/supabase-js";
import { isTransientAuthSessionError } from "@/features/auth/session-errors";
import { useTabsStoreHook } from "./tabs";
import { usePermissionStoreHook } from "./permission";
import { useNotificationStoreHook } from "./notification";
import { storageLocal } from "@/utils/shared";
import {
  getSupabaseClient,
  getSupabaseClientIfConfigured
} from "@/lib/supabase/client";
import type { Session } from "@template/contracts";

let authTransitionRevision = 0;
let lastAuthorizationRefreshAt = 0;
let sessionLoad: { authUserId: string; promise: Promise<Session | null> } | undefined;
let logoutPendingAuthUserId: string | undefined;

function loadSessionOnce(authUserId: string): Promise<Session | null> {
  if (sessionLoad?.authUserId === authUserId) return sessionLoad.promise;
  const promise = import("@/features/auth/auth.service")
    .then(({ restoreSupabaseSession }) => restoreSupabaseSession())
    .finally(() => {
      if (sessionLoad?.promise === promise) sessionLoad = undefined;
    });
  sessionLoad = { authUserId, promise };
  return promise;
}

function sessionUserState(session: Session) {
  const { profile } = session;
  return {
    authUserId: profile.authUserId,
    userId: profile.id,
    avatar: profile.avatarUrl ?? "",
    username: profile.loginName,
    nickname: profile.displayName,
    isAuthenticated: true,
    authReady: true,
    mustResetPassword: session.mustResetPassword
  };
}

export const useSessionStore = defineStore("session", {
  state: (): import("../types").sessionType => ({
    avatar: "",
    username: "",
    nickname: "",
    userId: "",
    authUserId: "",
    isAuthenticated: false,
    authReady: false,
    mustResetPassword: false
  }),
  actions: {
    SET_AVATAR(avatar: string) {
      this.avatar = avatar;
    },
    SET_NICKNAME(nickname: string) {
      this.nickname = nickname;
    },
    applySession(session: Session) {
      if (this.isAuthenticated && this.authUserId !== session.profile.authUserId) {
        this.clearLocalSession(false);
      }
      Object.assign(this, sessionUserState(session));
      usePermissionStoreHook().setAuthorization(session.roleCodes, session.permissionKeys);
      lastAuthorizationRefreshAt = Date.now();
      void useNotificationStoreHook().startMessageUpdates(session.profile.id);
    },
    clearLocalSession(invalidate = true) {
      if (invalidate) {
        authTransitionRevision += 1;
        invalidateAuthOperations();
        logoutPendingAuthUserId = undefined;
      }
      useNotificationStoreHook().reset();
      usePermissionStoreHook().clearAuthorization();
      storageLocal().removeItem("user-info");
      useTabsStoreHook().handleTags("equal", [...routerArrays]);
      resetRouter();
      this.avatar = "";
      this.username = "";
      this.nickname = "";
      this.userId = "";
      this.authUserId = "";
      this.isAuthenticated = false;
      this.authReady = true;
      this.mustResetPassword = false;
    },
    isLogoutPendingForAnotherAccount(authUserId?: string | null): boolean {
      return Boolean(
        logoutPendingAuthUserId &&
        authUserId &&
        authUserId !== logoutPendingAuthUserId
      );
    },
    isLogoutPendingForAccount(authUserId?: string | null): boolean {
      return Boolean(logoutPendingAuthUserId && authUserId === logoutPendingAuthUserId);
    },
    cancelPendingLogoutForAccountSwitch() {
      if (!logoutPendingAuthUserId) return;
      logoutPendingAuthUserId = undefined;
      authTransitionRevision += 1;
      invalidateAuthOperations();
    },
    async restoreSession(forceRefresh = false): Promise<boolean> {
      const client = getSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (error) {
        if (this.isAuthenticated && isTransientAuthSessionError(error)) return true;
        if (this.isAuthenticated && isAuthError(error)) {
          this.clearLocalSession(false);
          return false;
        }
        // Keep the last verified identity for unexpected local failures. RLS
        // still rejects any expired or revoked Session at the data boundary.
        if (this.isAuthenticated) return true;
        throw error;
      }
      const currentAuthSession = data.session;

      if (logoutPendingAuthUserId) {
        if (!currentAuthSession || currentAuthSession.user.id === logoutPendingAuthUserId) {
          return false;
        }
        logoutPendingAuthUserId = undefined;
      }

      if (!currentAuthSession) {
        if (this.isAuthenticated || !this.authReady) this.clearLocalSession();
        return false;
      }

      if (this.isAuthenticated && this.authUserId !== currentAuthSession.user.id) {
        this.clearLocalSession(false);
      }

      if (
        !forceRefresh &&
        this.isAuthenticated &&
        this.authUserId === currentAuthSession.user.id &&
        Date.now() - lastAuthorizationRefreshAt < 60_000
      ) {
        return true;
      }

      const transitionRevision = ++authTransitionRevision;
      const session = await loadSessionOnce(currentAuthSession.user.id);
      if (transitionRevision !== authTransitionRevision) {
        return this.isAuthenticated && this.authUserId === currentAuthSession.user.id;
      }
      if (!session) {
        this.clearLocalSession(false);
        return false;
      }
      this.applySession(session);
      return true;
    },
    async refreshAuthorization(
      refreshNavigation = false,
      forceRefresh = true
    ): Promise<boolean> {
      const previousAuthUserId = this.authUserId;
      const permissionStore = usePermissionStoreHook();
      const previousRoleCodes = [...permissionStore.roleCodes];
      const previousPermissionKeys = [...permissionStore.permissionKeys];
      const currentPath = router.currentRoute.value.fullPath;
      let restored: boolean;
      try {
        restored = await this.restoreSession(forceRefresh);
      } catch {
        return this.isAuthenticated;
      }
      if (!restored) {
        if (
          currentPath !== "/login" &&
          currentPath !== "/reset-password" &&
          currentPath !== "/access-denied" &&
          currentPath !== "/server-error"
        ) {
          await router.replace("/login");
        }
        return false;
      }

      const sessionChanged = previousAuthUserId !== this.authUserId
        || previousRoleCodes.join("\0") !== permissionStore.roleCodes.join("\0")
        || previousPermissionKeys.join("\0") !== permissionStore.permissionKeys.join("\0");
      if (sessionChanged || refreshNavigation) {
        try {
          await initRouter();
        } catch {
          // Preserve the last installed navigation if a temporary request fails.
          return this.isAuthenticated;
        }
        if (sessionChanged) {
          useTabsStoreHook().handleTags("equal", [...routerArrays]);
        }
        if (currentPath === "/login") {
          const landingMenu = getTopMenu(true);
          await router.replace(landingMenu?.path ?? "/access-denied");
        } else if (
          currentPath !== "/login" &&
          currentPath !== "/reset-password" &&
          currentPath !== "/access-denied" &&
          currentPath !== "/server-error"
        ) {
          const activeRoute = router.resolve(currentPath);
          const activePermissions = Array.isArray(activeRoute.meta.auths)
            ? activeRoute.meta.auths
            : [];
          const stillRegistered = activeRoute.matched.some(record => record.meta.backstage);
          if (
            !stillRegistered ||
            activePermissions.some(permission => !permissionStore.permissionKeys.includes(String(permission)))
          ) {
            await router.replace("/access-denied");
          } else {
            await router.replace(currentPath);
          }
        }
      }
      void useNotificationStoreHook().startMessageUpdates(this.userId);
      return true;
    },
    /** Sign in with the sole supported method: login name and password. */
    async loginByUsername(data: { username: string; password: string }) {
      logoutPendingAuthUserId = undefined;
      const transitionRevision = ++authTransitionRevision;
      const { loginWithSupabase } = await import("@/features/auth/auth.service");
      const result = await loginWithSupabase({
        loginName: data.username,
        password: data.password
      });
      if (result.success && transitionRevision === authTransitionRevision) {
        this.applySession(result.data);
      }
      return result;
    },
    /** Clear local UI state immediately; revoke and clear only the session being logged out. */
    async logOut(): Promise<{ serverSessionRevoked: boolean }> {
      const loggingOutAuthUserId = this.authUserId;
      logoutPendingAuthUserId = loggingOutAuthUserId || undefined;
      authTransitionRevision += 1;
      const operationRevision = invalidateAuthOperations();
      this.clearLocalSession(false);

      let serverSessionRevoked = false;
      const client = getSupabaseClientIfConfigured();
      if (client && loggingOutAuthUserId) {
        try {
          const { data: current } = await client.auth.getSession();
          if (current.session?.user.id === loggingOutAuthUserId && isCurrentAuthOperation(operationRevision)) {
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 5_000);
            try {
              const { data, error } = await client
                .rpc("revoke_account_password_session")
                .abortSignal(controller.signal);
              serverSessionRevoked = !error && data === true;
            } finally {
              window.clearTimeout(timeout);
            }
            const { data: latest } = await client.auth.getSession();
            if (
              latest.session?.user.id === loggingOutAuthUserId &&
              isCurrentAuthOperation(operationRevision)
            ) {
              await client.auth.signOut({ scope: "local" }).catch(() => undefined);
            }
          } else if (current.session?.user.id !== loggingOutAuthUserId) {
            // A second tab may already have installed a different account.
            // Let that session refresh rather than signing it out as a late result.
            logoutPendingAuthUserId = undefined;
          }
        } catch {
          // When the current account cannot be checked, clear this local
          // Auth session if no newer login has superseded the logout.
          if (isCurrentAuthOperation(operationRevision)) {
            await client.auth.signOut({ scope: "local" }).catch(() => undefined);
          }
        }
      } else if (!loggingOutAuthUserId) {
        await client?.auth.signOut({ scope: "local" }).catch(() => undefined);
      }

      if (
        isCurrentAuthOperation(operationRevision) &&
        router.currentRoute.value.path !== "/login"
      ) {
        await router.replace("/login");
      }
      return { serverSessionRevoked };
    }
  }
});

export function useSessionStoreHook() {
  return useSessionStore(store);
}
