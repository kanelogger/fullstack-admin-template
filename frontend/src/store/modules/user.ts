import { defineStore } from "pinia";
import { store, router, resetRouter, routerArrays } from "../utils";
import { invalidateAuthOperations, isCurrentAuthOperation } from "@/features/auth/session-generation";
import { useMultiTagsStoreHook } from "./multiTags";
import { useNotificationStoreHook } from "./notification";
import { cacheUserInfo, clearCachedUserInfo } from "@/utils/user-info";
import type { Session } from "@/contracts";

let authTransitionRevision = 0;

function sessionUserState(session: Session) {
  const { profile, roleCodes, permissionKeys } = session;
  return {
    authUserId: profile.authUserId,
    userId: profile.id,
    avatar: profile.avatarUrl ?? "",
    username: profile.loginName,
    nickname: profile.displayName,
    roles: roleCodes,
    permissions: permissionKeys,
    isAuthenticated: true,
    authReady: true,
    mustResetPassword: session.mustResetPassword
  };
}

export const useUserStore = defineStore("auth-user", {
  state: (): import("../types").userType => ({
    avatar: "",
    username: "",
    nickname: "",
    userId: "",
    authUserId: "",
    roles: [],
    permissions: [],
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
      Object.assign(this, sessionUserState(session));
      cacheUserInfo({
        userId: session.profile.id,
        authUserId: session.profile.authUserId,
        avatar: session.profile.avatarUrl ?? "",
        username: session.profile.loginName,
        nickname: session.profile.displayName,
        roles: session.roleCodes,
        permissions: session.permissionKeys
      });
    },
    clearLocalSession(invalidate = true) {
      if (invalidate) {
        authTransitionRevision += 1;
        invalidateAuthOperations();
      }
      useNotificationStoreHook().reset();
      clearCachedUserInfo();
      this.avatar = "";
      this.username = "";
      this.nickname = "";
      this.userId = "";
      this.authUserId = "";
      this.roles = [];
      this.permissions = [];
      this.isAuthenticated = false;
      this.authReady = true;
      this.mustResetPassword = false;
    },
    async restoreSession(): Promise<boolean> {
      const { getSupabaseClient } = await import("@/shared/supabase/client");
      const client = getSupabaseClient();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const currentAuthSession = data.session;

      if (!currentAuthSession) {
        if (this.isAuthenticated || !this.authReady) this.clearLocalSession(false);
        return false;
      }

      if (this.isAuthenticated && this.authUserId === currentAuthSession.user.id) {
        return true;
      }

      const transitionRevision = ++authTransitionRevision;
      const { restoreSupabaseSession } = await import("@/features/auth/auth.service");
      const session = await restoreSupabaseSession();
      if (transitionRevision !== authTransitionRevision) {
        return this.isAuthenticated;
      }
      if (!session) {
        this.clearLocalSession(false);
        return false;
      }
      this.applySession(session);
      return true;
    },
    /** Sign in with the sole supported method: login name and password. */
    async loginByUsername(data: { username: string; password: string }) {
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
    logOut() {
      const loggingOutAuthUserId = this.authUserId;
      authTransitionRevision += 1;
      const operationRevision = invalidateAuthOperations();
      this.clearLocalSession(false);
      useMultiTagsStoreHook().handleTags("equal", [...routerArrays]);
      resetRouter();
      if (router.currentRoute.value.path !== "/login") {
        void router.push("/login");
      }

      void import("@/shared/supabase/client")
        .then(async ({ getSupabaseClientIfConfigured }) => {
          const client = getSupabaseClientIfConfigured();
          if (!client || !loggingOutAuthUserId) return;
          const { data } = await client.auth.getSession();
          if (
            !data.session ||
            data.session.user.id !== loggingOutAuthUserId ||
            !isCurrentAuthOperation(operationRevision)
          ) return;

          try {
            await client.rpc("revoke_account_password_session");
          } catch {
            // Local sign-out still proceeds when server-side revocation is unavailable.
          }

          const { data: latest } = await client.auth.getSession();
          if (
            latest.session?.user.id === loggingOutAuthUserId &&
            isCurrentAuthOperation(operationRevision)
          ) {
            await client.auth.signOut({ scope: "local" });
          }
        })
        .catch(() => undefined);
    }
  }
});

export function useUserStoreHook() {
  return useUserStore(store);
}
