import { isSameAuthSession, type AuthSessionIdentity } from "./session-identity";

export type AuthSessionOwner = {
  authUserId: string;
  sessionId: string;
};

export type SessionCoordinatorState = {
  authOperationRevision: number;
  transitionRevision: number;
  pendingLogout: AuthSessionOwner | null;
  pendingLogin: AuthSessionOwner | null;
};

export type SessionCoordinatorEvent =
  | { type: "restore-started" }
  | { type: "auth-operation-started" }
  | { type: "login-session-expected"; revision: number; owner: AuthSessionOwner }
  | { type: "auth-operation-completed"; revision: number }
  | { type: "logout-started"; owner: AuthSessionOwner }
  | { type: "auth-session-observed"; owner: AuthSessionOwner }
  | { type: "auth-session-rejected" }
  | { type: "logout-completed"; owner: AuthSessionOwner };

export type AuthSessionCommitGuard = {
  identity: Pick<AuthSessionIdentity, "authUserId" | "sessionId">;
  transitionRevision: number;
  authOperationRevision: number;
};

function sameOwner(left: AuthSessionOwner | null, right: AuthSessionOwner): boolean {
  return Boolean(
    left && left.authUserId === right.authUserId && left.sessionId === right.sessionId
  );
}

export function reduceSessionCoordinator(
  state: SessionCoordinatorState,
  event: SessionCoordinatorEvent
): SessionCoordinatorState {
  switch (event.type) {
    case "restore-started":
      return { ...state, transitionRevision: state.transitionRevision + 1 };
    case "auth-operation-started":
      return {
        authOperationRevision: state.authOperationRevision + 1,
        transitionRevision: state.transitionRevision + 1,
        pendingLogout: null,
        pendingLogin: null
      };
    case "login-session-expected":
      return state.authOperationRevision === event.revision
        ? { ...state, pendingLogin: event.owner }
        : state;
    case "auth-operation-completed":
      return state.authOperationRevision === event.revision
        ? { ...state, pendingLogin: null }
        : state;
    case "logout-started":
      return {
        authOperationRevision: state.authOperationRevision + 1,
        transitionRevision: state.transitionRevision + 1,
        pendingLogout: event.owner,
        pendingLogin: null
      };
    case "auth-session-observed":
      if (sameOwner(state.pendingLogin, event.owner)) return state;
      return {
        authOperationRevision: state.authOperationRevision + 1,
        transitionRevision: state.transitionRevision + 1,
        pendingLogout: sameOwner(state.pendingLogout, event.owner) ? state.pendingLogout : null,
        pendingLogin: null
      };
    case "auth-session-rejected":
      return {
        authOperationRevision: state.authOperationRevision + 1,
        transitionRevision: state.transitionRevision + 1,
        pendingLogout: null,
        pendingLogin: null
      };
    case "logout-completed":
      return sameOwner(state.pendingLogout, event.owner)
        ? { ...state, pendingLogout: null }
        : state;
  }
}

let coordinator: SessionCoordinatorState = {
  authOperationRevision: 0,
  transitionRevision: 0,
  pendingLogout: null,
  pendingLogin: null
};

function dispatch(event: SessionCoordinatorEvent): SessionCoordinatorState {
  coordinator = reduceSessionCoordinator(coordinator, event);
  return coordinator;
}

export function getAuthOperationRevision(): number {
  return coordinator.authOperationRevision;
}

export function getSessionTransitionRevision(): number {
  return coordinator.transitionRevision;
}

export function beginSessionRestore(): number {
  return dispatch({ type: "restore-started" }).transitionRevision;
}

/** Start a login or recovery operation and invalidate its stale predecessors. */
export function beginAuthOperation(): number {
  return dispatch({ type: "auth-operation-started" }).authOperationRevision;
}

export function expectAuthSessionForOperation(revision: number, owner: AuthSessionOwner): boolean {
  if (coordinator.authOperationRevision !== revision) return false;
  dispatch({ type: "login-session-expected", revision, owner });
  return sameOwner(coordinator.pendingLogin, owner);
}

export function completeAuthOperation(revision: number): void {
  dispatch({ type: "auth-operation-completed", revision });
}

/** Start logout for one exact Auth Session. */
export function beginSessionLogout(owner: AuthSessionOwner): number {
  return dispatch({ type: "logout-started", owner }).authOperationRevision;
}

/** A different session was installed; all results and effects for the previous one are stale. */
export function observeAuthSession(owner: AuthSessionOwner): void {
  dispatch({ type: "auth-session-observed", owner });
}

export function rejectAuthSession(): void {
  dispatch({ type: "auth-session-rejected" });
}

export function completeSessionLogout(owner: AuthSessionOwner): void {
  dispatch({ type: "logout-completed", owner });
}

export function getPendingSessionLogout(): AuthSessionOwner | null {
  return coordinator.pendingLogout;
}

export function isCurrentAuthOperation(revision: number): boolean {
  return coordinator.authOperationRevision === revision;
}

export function isCurrentSessionTransition(revision: number): boolean {
  return coordinator.transitionRevision === revision;
}

/** Apply a synchronous side effect only while its exact Auth Session still owns the operation. */
export function commitForCurrentAuthSession(
  guard: AuthSessionCommitGuard,
  currentIdentity: Pick<AuthSessionIdentity, "authUserId" | "sessionId"> | null,
  commit: () => void
): boolean {
  if (
    !isCurrentSessionTransition(guard.transitionRevision) ||
    !isCurrentAuthOperation(guard.authOperationRevision) ||
    !isSameAuthSession(currentIdentity, guard.identity)
  )
    return false;
  commit();
  return true;
}
