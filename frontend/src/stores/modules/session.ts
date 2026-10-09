import { defineStore } from "pinia";
import type { AppError } from "@template/contracts";
import { store, router, resetRouter, routerArrays, initRouter } from "../utils";
import { getTopMenu } from "@/router/utils";
import {
  beginAuthOperation,
  commitForCurrentAuthSession,
  beginSessionLogout,
  beginSessionRestore,
  completeSessionLogout,
  getAuthOperationRevision,
  getPendingSessionLogout,
  getSessionTransitionRevision,
  isCurrentAuthOperation,
  isCurrentSessionTransition,
  observeAuthSession,
  rejectAuthSession
} from "@/features/auth/session-generation";
import { withAuthSessionLock } from "@/features/auth/auth-session-lock";
import {
  getAuthSessionIdentity,
  isSameAuthSession,
  type AuthSessionIdentity
} from "@/features/auth/session-identity";
import { isAuthError } from "@supabase/supabase-js";
import {
  isAuthSessionRejectedError,
  isTransientAuthSessionError
} from "@/features/auth/session-errors";
import { useTabsStoreHook } from "./tabs";
import { usePermissionStoreHook } from "./permission";
import { useNotificationStoreHook } from "./notification";
import { storageLocal } from "@/utils/shared";
import { getSupabaseClient, getSupabaseClientIfConfigured } from "@/lib/supabase/client";
import type { Session } from "@template/contracts";

type SessionLoginOutcome =
  | { success: true; data: Session; authSessionId: string }
  | { success: false; error: AppError };

function sessionChangedLoginFailure(): SessionLoginOutcome {
  return { success: false, error: { code: "SESSION_CHANGED", message: "登录状态已变化，请重试" } };
}

let lastAuthorizationRefreshAt = 0;
let sessionLoad: { key: string; promise: Promise<Session | null> } | undefined;

function loadSessionOnce(
  identity: Pick<AuthSessionIdentity, "authUserId" | "sessionId">
): Promise<Session | null> {
  const key = `${identity.authUserId}\0${identity.sessionId}`;
  if (sessionLoad?.key === key) return sessionLoad.promise;
  const promise = import("@/features/auth/auth.service")
    .then(({ restoreSupabaseSession }) => restoreSupabaseSession(identity))
    .finally(() => {
      if (sessionLoad?.promise === promise) sessionLoad = undefined;
    });
  sessionLoad = { key, promise };
  return promise;
}

function sessionUserState(session: Session, sessionId: string) {
  const { profile } = session;
  return {
    authUserId: profile.authUserId,
    authSessionId: sessionId,
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
    authSessionId: "",
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
    applySession(session: Session, sessionId: string) {
      if (
        this.isAuthenticated &&
        (this.authUserId !== session.profile.authUserId || this.authSessionId !== sessionId)
      ) {
        this.clearLocalSession(false);
      }
      Object.assign(this, sessionUserState(session, sessionId));
      usePermissionStoreHook().setAuthorization(session.roleCodes, session.permissionKeys);
      lastAuthorizationRefreshAt = Date.now();
      const expectedIdentity = { authUserId: session.profile.authUserId, sessionId };
      void useNotificationStoreHook().startMessageUpdates(
        session.profile.id,
        () =>
          this.isAuthenticated &&
          this.authUserId === expectedIdentity.authUserId &&
          this.authSessionId === expectedIdentity.sessionId
      );
    },
    clearLocalSession(invalidate = true) {
      if (invalidate) {
        rejectAuthSession();
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
      this.authSessionId = "";
      this.isAuthenticated = false;
      this.authReady = true;
      this.mustResetPassword = false;
    },
    isLogoutPendingForAnotherAccount(
      authUserId?: string | null,
      sessionId?: string | null
    ): boolean {
      const pending = getPendingSessionLogout();
      return Boolean(
        pending && (authUserId !== pending.authUserId || sessionId !== pending.sessionId)
      );
    },
    isLogoutPendingForAccount(authUserId?: string | null, sessionId?: string | null): boolean {
      const pending = getPendingSessionLogout();
      return Boolean(
        pending && authUserId === pending.authUserId && sessionId === pending.sessionId
      );
    },
    observeAuthSession(identity: Pick<AuthSessionIdentity, "authUserId" | "sessionId">): boolean {
      const pending = getPendingSessionLogout();
      if (pending && !isSameAuthSession(pending, identity)) {
        observeAuthSession(identity);
        return true;
      }
      if (
        this.isAuthenticated &&
        isSameAuthSession({ authUserId: this.authUserId, sessionId: this.authSessionId }, identity)
      )
        return false;
      if (this.isLogoutPendingForAccount(identity.authUserId, identity.sessionId)) return false;
      observeAuthSession(identity);
      return true;
    },
    async isCurrentPersistedAuthSession(
      identity: Pick<AuthSessionIdentity, "authUserId" | "sessionId">
    ): Promise<boolean> {
      if (
        !this.isAuthenticated ||
        this.authUserId !== identity.authUserId ||
        this.authSessionId !== identity.sessionId
      )
        return false;
      const { data, error } = await getSupabaseClient().auth.getSession();
      return (
        !error &&
        this.isAuthenticated &&
        this.authUserId === identity.authUserId &&
        this.authSessionId === identity.sessionId &&
        isSameAuthSession(getAuthSessionIdentity(data.session), identity)
      );
    },
    async initSessionNavigation(
      expectedIdentity?: Pick<AuthSessionIdentity, "authUserId" | "sessionId">
    ): Promise<boolean> {
      const identity = expectedIdentity ?? {
        authUserId: this.authUserId,
        sessionId: this.authSessionId
      };
      if (
        !this.isAuthenticated ||
        !identity.authUserId ||
        !identity.sessionId ||
        !isSameAuthSession({ authUserId: this.authUserId, sessionId: this.authSessionId }, identity)
      )
        return false;
      const transitionRevision = getSessionTransitionRevision();
      const authOperationRevision = getAuthOperationRevision();
      if (!(await this.isCurrentPersistedAuthSession(identity))) return false;
      if (
        !isCurrentSessionTransition(transitionRevision) ||
        !isCurrentAuthOperation(authOperationRevision)
      )
        return false;
      return initRouter({ identity, transitionRevision, authOperationRevision });
    },
    async restoreSession(forceRefresh = false): Promise<boolean> {
      let transitionRevision = beginSessionRestore();
      let authOperationRevision = getAuthOperationRevision();
      const client = getSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (!isCurrentSessionTransition(transitionRevision)) return this.isAuthenticated;
      if (error) {
        if (this.isAuthenticated && isTransientAuthSessionError(error)) return true;
        if (this.isAuthenticated && isAuthError(error)) {
          this.clearLocalSession();
          return this.isAuthenticated;
        }
        // Keep the last verified identity for unexpected local failures. RLS
        // still rejects any expired or revoked Session at the data boundary.
        if (this.isAuthenticated) return true;
        throw error;
      }
      const currentAuthSession = data.session;
      if (!currentAuthSession) {
        if (this.isAuthenticated || !this.authReady) this.clearLocalSession();
        return false;
      }
      const identity = getAuthSessionIdentity(currentAuthSession);
      if (!identity) {
        this.clearLocalSession();
        return false;
      }

      const pendingLogout = getPendingSessionLogout();
      if (
        pendingLogout &&
        pendingLogout.authUserId === identity.authUserId &&
        pendingLogout.sessionId === identity.sessionId
      )
        return false;

      if (pendingLogout && !isSameAuthSession(pendingLogout, identity)) {
        observeAuthSession(identity);
        transitionRevision = getSessionTransitionRevision();
        authOperationRevision = getAuthOperationRevision();
      } else if (
        this.isAuthenticated &&
        !isSameAuthSession({ authUserId: this.authUserId, sessionId: this.authSessionId }, identity)
      ) {
        observeAuthSession(identity);
        this.clearLocalSession(false);
        transitionRevision = getSessionTransitionRevision();
        authOperationRevision = getAuthOperationRevision();
      }

      if (
        !forceRefresh &&
        this.isAuthenticated &&
        this.authUserId === identity.authUserId &&
        this.authSessionId === identity.sessionId &&
        Date.now() - lastAuthorizationRefreshAt < 60_000
      ) {
        return true;
      }

      let session: Session | null;
      try {
        session = await loadSessionOnce(identity);
      } catch (error) {
        if (!isAuthSessionRejectedError(error)) throw error;
        if (
          !isCurrentSessionTransition(transitionRevision) ||
          !isCurrentAuthOperation(authOperationRevision) ||
          (this.isAuthenticated &&
            !isSameAuthSession(
              { authUserId: this.authUserId, sessionId: this.authSessionId },
              identity
            ))
        )
          return this.isAuthenticated;
        if (!this.isAuthenticated) {
          const { clearRejectedSupabaseSessionIfCurrent } =
            await import("@/features/auth/auth.service");
          const cleared = await clearRejectedSupabaseSessionIfCurrent(identity);
          if (
            !cleared &&
            isCurrentSessionTransition(transitionRevision) &&
            isCurrentAuthOperation(authOperationRevision)
          ) {
            const { data: current, error: currentError } = await client.auth.getSession();
            const currentIdentity = getAuthSessionIdentity(current.session);
            if (!currentError && currentIdentity && !isSameAuthSession(currentIdentity, identity)) {
              this.observeAuthSession(currentIdentity);
              return this.restoreSession(true);
            }
          }
          return this.isAuthenticated;
        }
        const { data: latest, error: latestError } = await client.auth.getSession();
        if (
          latestError ||
          !isCurrentSessionTransition(transitionRevision) ||
          !isCurrentAuthOperation(authOperationRevision)
        )
          return this.isAuthenticated;
        const latestIdentity = getAuthSessionIdentity(latest.session);
        if (!isSameAuthSession(latestIdentity, identity)) {
          if (latestIdentity) {
            this.observeAuthSession(latestIdentity);
            return this.restoreSession(true);
          }
          this.clearLocalSession();
          return false;
        }
        const logout = await this.logOut(identity);
        if (
          logout.ignored &&
          isCurrentSessionTransition(transitionRevision) &&
          isCurrentAuthOperation(authOperationRevision) &&
          this.isAuthenticated &&
          isSameAuthSession(
            { authUserId: this.authUserId, sessionId: this.authSessionId },
            identity
          )
        ) {
          this.clearLocalSession();
          if (router.currentRoute.value.path !== "/login") await router.replace("/login");
        }
        return false;
      }
      if (
        !isCurrentSessionTransition(transitionRevision) ||
        !isCurrentAuthOperation(authOperationRevision)
      )
        return this.isAuthenticated;
      if (!session) {
        this.clearLocalSession();
        return false;
      }

      const { data: latest } = await client.auth.getSession();
      const latestIdentity = getAuthSessionIdentity(latest.session);
      if (
        !isCurrentSessionTransition(transitionRevision) ||
        !isCurrentAuthOperation(authOperationRevision)
      )
        return this.isAuthenticated;
      if (!isSameAuthSession(latestIdentity, identity)) {
        if (latestIdentity) {
          this.observeAuthSession(latestIdentity);
          return this.restoreSession(true);
        }
        this.clearLocalSession();
        return false;
      }
      this.applySession(session, identity.sessionId);
      return true;
    },
    async refreshAuthorization(refreshNavigation = false, forceRefresh = true): Promise<boolean> {
      const previousAuthUserId = this.authUserId;
      const previousAuthSessionId = this.authSessionId;
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
        const transitionRevision = getSessionTransitionRevision();
        const operationRevision = getAuthOperationRevision();
        const { data: current, error } = await getSupabaseClient().auth.getSession();
        if (
          error ||
          current.session ||
          this.isAuthenticated ||
          !isCurrentSessionTransition(transitionRevision) ||
          !isCurrentAuthOperation(operationRevision)
        )
          return this.isAuthenticated;
        if (
          currentPath !== "/login" &&
          currentPath !== "/reset-password" &&
          currentPath !== "/access-denied" &&
          currentPath !== "/server-error"
        ) {
          if (
            !isCurrentSessionTransition(transitionRevision) ||
            !isCurrentAuthOperation(operationRevision) ||
            this.isAuthenticated
          )
            return this.isAuthenticated;
          await router.replace("/login");
        }
        return false;
      }

      const sessionChanged =
        previousAuthUserId !== this.authUserId ||
        previousAuthSessionId !== this.authSessionId ||
        previousRoleCodes.join("\0") !== permissionStore.roleCodes.join("\0") ||
        previousPermissionKeys.join("\0") !== permissionStore.permissionKeys.join("\0");
      if (sessionChanged || refreshNavigation) {
        const expectedIdentity = { authUserId: this.authUserId, sessionId: this.authSessionId };
        if (!(await this.isCurrentPersistedAuthSession(expectedIdentity))) {
          return this.isAuthenticated;
        }
        const acceptedRevision = getSessionTransitionRevision();
        const acceptedOperation = getAuthOperationRevision();
        try {
          if (!(await this.initSessionNavigation(expectedIdentity))) return this.isAuthenticated;
        } catch {
          // Preserve the last installed navigation if a temporary request fails.
          return this.isAuthenticated;
        }
        if (
          !isCurrentSessionTransition(acceptedRevision) ||
          !isCurrentAuthOperation(acceptedOperation) ||
          !(await this.isCurrentPersistedAuthSession(expectedIdentity))
        )
          return this.isAuthenticated;
        if (sessionChanged) {
          useTabsStoreHook().handleTags("equal", [...routerArrays]);
        }
        if (currentPath === "/login") {
          if (!(await this.isCurrentPersistedAuthSession(expectedIdentity)))
            return this.isAuthenticated;
          const landingMenu = getTopMenu(true);
          await router.replace(landingMenu?.path ?? "/access-denied");
        } else if (
          currentPath !== "/login" &&
          currentPath !== "/reset-password" &&
          currentPath !== "/access-denied" &&
          currentPath !== "/server-error"
        ) {
          if (!(await this.isCurrentPersistedAuthSession(expectedIdentity)))
            return this.isAuthenticated;
          const activeRoute = router.resolve(currentPath);
          const activePermissions = Array.isArray(activeRoute.meta.auths)
            ? activeRoute.meta.auths
            : [];
          const stillRegistered = activeRoute.matched.some((record) => record.meta.backstage);
          if (
            !stillRegistered ||
            activePermissions.some(
              (permission) => !permissionStore.permissionKeys.includes(String(permission))
            )
          ) {
            await router.replace("/access-denied");
          } else {
            await router.replace(currentPath);
          }
        }
      }
      const expectedIdentity = { authUserId: this.authUserId, sessionId: this.authSessionId };
      if (await this.isCurrentPersistedAuthSession(expectedIdentity)) {
        void useNotificationStoreHook().startMessageUpdates(
          this.userId,
          () =>
            this.isAuthenticated &&
            this.authUserId === expectedIdentity.authUserId &&
            this.authSessionId === expectedIdentity.sessionId
        );
      }
      return true;
    },
    /** Sign in with the sole supported method: login name and password. */
    async loginByUsername(data: {
      username: string;
      password: string;
    }): Promise<SessionLoginOutcome> {
      const operationRevision = beginAuthOperation();
      const transitionRevision = getSessionTransitionRevision();
      const { loginWithSupabase } = await import("@/features/auth/auth.service");
      const result = await loginWithSupabase(
        {
          loginName: data.username,
          password: data.password
        },
        operationRevision
      );
      if ("error" in result) return { success: false, error: result.error };
      if (
        isCurrentAuthOperation(operationRevision) &&
        isCurrentSessionTransition(transitionRevision)
      ) {
        const identity = {
          authUserId: result.data.profile.authUserId,
          sessionId: result.authSessionId
        };
        const { data: current, error } = await getSupabaseClient().auth.getSession();
        const applied =
          !error &&
          commitForCurrentAuthSession(
            {
              identity,
              transitionRevision,
              authOperationRevision: operationRevision
            },
            getAuthSessionIdentity(current.session),
            () => this.applySession(result.data, identity.sessionId)
          );
        if (applied) {
          return { success: true as const, data: result.data, authSessionId: result.authSessionId };
        } else if (!error && current.session) {
          const currentIdentity = getAuthSessionIdentity(current.session);
          if (currentIdentity) this.observeAuthSession(currentIdentity);
        }
        await result.discardIfStale();
        return sessionChangedLoginFailure();
      }
      await result.discardIfStale();
      return sessionChangedLoginFailure();
    },
    /** Clear local UI state immediately; revoke and clear only the session being logged out. */
    async logOut(
      expectedIdentity?: Pick<AuthSessionIdentity, "authUserId" | "sessionId">
    ): Promise<{ serverSessionRevoked: boolean; ignored?: boolean }> {
      const loggingOutIdentity = this.isAuthenticated
        ? { authUserId: this.authUserId, sessionId: this.authSessionId }
        : null;
      if (expectedIdentity && !isSameAuthSession(loggingOutIdentity, expectedIdentity)) {
        return { serverSessionRevoked: false, ignored: true };
      }
      if (!loggingOutIdentity) {
        this.clearLocalSession(false);
        if (router.currentRoute.value.path !== "/login") await router.replace("/login");
        return { serverSessionRevoked: false };
      }
      const client = getSupabaseClientIfConfigured();
      if (!client) {
        rejectAuthSession();
        this.clearLocalSession(false);
        if (router.currentRoute.value.path !== "/login") await router.replace("/login");
        return { serverSessionRevoked: false };
      }

      let capturedIdentity: AuthSessionIdentity | null = null;
      let operationRevision = 0;
      try {
        await withAuthSessionLock(async () => {
          const { data: current, error } = await client.auth.getSession();
          if (error) return;
          capturedIdentity = getAuthSessionIdentity(current.session);
          if (!isSameAuthSession(capturedIdentity, loggingOutIdentity)) return;
          operationRevision = beginSessionLogout(loggingOutIdentity);
          this.clearLocalSession(false);
          if (
            isCurrentAuthOperation(operationRevision) &&
            !this.isAuthenticated &&
            router.currentRoute.value.path !== "/login"
          )
            await router.replace("/login");
        });
      } catch {
        return { serverSessionRevoked: false, ...(expectedIdentity ? { ignored: true } : {}) };
      }

      if (!capturedIdentity || !operationRevision) {
        const { data: latest, error } = await client.auth.getSession();
        const latestIdentity = getAuthSessionIdentity(latest.session);
        if (!error && latestIdentity) {
          this.observeAuthSession(latestIdentity);
          void this.refreshAuthorization(true);
        }
        return {
          serverSessionRevoked: false,
          ...(expectedIdentity ? { ignored: true } : {})
        };
      }

      let serverSessionRevoked = false;
      // This request carries only the captured old token, so a newer Session in
      // another tab cannot be revoked by this cleanup operation.
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5_000);
      try {
        const { revokeSupabaseAuthSession } = await import("@/features/auth/auth.service");
        serverSessionRevoked = await revokeSupabaseAuthSession(capturedIdentity, controller.signal);
      } catch {
        // Report an unconfirmed revocation to the caller.
      } finally {
        window.clearTimeout(timeout);
      }

      try {
        await withAuthSessionLock(async () => {
          const { data: latest, error } = await client.auth.getSession();
          const latestIdentity = getAuthSessionIdentity(latest.session);
          if (
            !error &&
            isCurrentAuthOperation(operationRevision) &&
            isSameAuthSession(latestIdentity, loggingOutIdentity)
          ) {
            await client.auth.signOut({ scope: "local" }).catch(() => undefined);
          } else if (
            !error &&
            latestIdentity &&
            !isSameAuthSession(latestIdentity, loggingOutIdentity)
          ) {
            this.observeAuthSession(latestIdentity);
            void this.refreshAuthorization(true);
          }
        });
      } finally {
        completeSessionLogout(loggingOutIdentity);
      }
      return { serverSessionRevoked };
    }
  }
});

export function useSessionStoreHook() {
  return useSessionStore(store);
}
