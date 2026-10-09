import { beforeEach, describe, expect, it } from "vitest";
import {
  beginAuthOperation,
  beginSessionRestore,
  beginSessionLogout,
  commitForCurrentAuthSession,
  getAuthOperationRevision,
  getPendingSessionLogout,
  getSessionTransitionRevision,
  isCurrentAuthOperation,
  isCurrentSessionTransition,
  observeAuthSession,
  reduceSessionCoordinator,
  rejectAuthSession,
  type SessionCoordinatorState
} from "./session-generation";

describe("auth operation revisions", () => {
  beforeEach(() => {
    rejectAuthSession();
  });

  it("rejects an older login result after another login starts", () => {
    const firstLogin = beginAuthOperation();
    const secondLogin = beginAuthOperation();

    expect(isCurrentAuthOperation(firstLogin)).toBe(false);
    expect(isCurrentAuthOperation(secondLogin)).toBe(true);
  });

  it("rejects a pending login result after logout", () => {
    const login = beginAuthOperation();
    rejectAuthSession();

    expect(isCurrentAuthOperation(login)).toBe(false);
  });

  it("advances the two revisions independently and tracks exact Session ownership", () => {
    const first: SessionCoordinatorState = {
      authOperationRevision: 4,
      transitionRevision: 7,
      pendingLogout: null,
      pendingLogin: null
    };
    const restoring = reduceSessionCoordinator(first, { type: "restore-started" });
    expect(restoring).toEqual({ ...first, transitionRevision: 8 });

    const loggingOut = reduceSessionCoordinator(restoring, {
      type: "logout-started",
      owner: { authUserId: "alice", sessionId: "session-a" }
    });
    expect(loggingOut).toEqual({
      authOperationRevision: 5,
      transitionRevision: 9,
      pendingLogout: { authUserId: "alice", sessionId: "session-a" },
      pendingLogin: null
    });

    const sameAccountNewSession = reduceSessionCoordinator(loggingOut, {
      type: "auth-session-observed",
      owner: { authUserId: "alice", sessionId: "session-b" }
    });
    expect(sameAccountNewSession).toEqual({
      authOperationRevision: 6,
      transitionRevision: 10,
      pendingLogout: null,
      pendingLogin: null
    });
  });

  it("rejects older UI work when a new session for the same account is observed", () => {
    const oldTransition = getSessionTransitionRevision();
    const operation = beginAuthOperation();
    observeAuthSession({ authUserId: "alice", sessionId: "session-new" });
    expect(isCurrentAuthOperation(operation)).toBe(false);
    expect(isCurrentSessionTransition(oldTransition)).toBe(false);
    expect(getPendingSessionLogout()).toBeNull();
    expect(beginSessionLogout({ authUserId: "alice", sessionId: "session-new" })).toBeGreaterThan(
      operation
    );
  });

  it("does not invalidate a login when Auth reports the Session created by that operation", () => {
    const state: SessionCoordinatorState = {
      authOperationRevision: 8,
      transitionRevision: 12,
      pendingLogout: null,
      pendingLogin: { authUserId: "alice", sessionId: "new-session" }
    };
    expect(
      reduceSessionCoordinator(state, {
        type: "auth-session-observed",
        owner: { authUserId: "alice", sessionId: "new-session" }
      })
    ).toEqual(state);
  });

  it("does not install a delayed navigation result after a newer Session takes ownership", async () => {
    const authUserId = "11111111-1111-4111-8111-111111111111";
    const oldIdentity = { authUserId, sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const newIdentity = { authUserId, sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const guard = {
      identity: oldIdentity,
      transitionRevision: beginSessionRestore(),
      authOperationRevision: getAuthOperationRevision()
    };
    let resolveNavigation!: (identity: typeof oldIdentity) => void;
    let installed = false;
    const delayedNavigation = new Promise<typeof oldIdentity>((resolve) => {
      resolveNavigation = resolve;
    });
    const commitPendingNavigation = delayedNavigation.then((identity) =>
      commitForCurrentAuthSession(guard, identity, () => {
        installed = true;
      })
    );

    observeAuthSession(newIdentity);
    resolveNavigation(oldIdentity);

    await expect(commitPendingNavigation).resolves.toBe(false);
    expect(installed).toBe(false);
  });

  it("checks the operation revision again after a delayed persisted-session read", async () => {
    const identity = {
      authUserId: "11111111-1111-4111-8111-111111111111",
      sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    };
    const guard = {
      identity,
      transitionRevision: beginSessionRestore(),
      authOperationRevision: getAuthOperationRevision()
    };
    let resolvePersistedIdentity!: (value: typeof identity) => void;
    let applied = false;
    const delayedRead = new Promise<typeof identity>((resolve) => {
      resolvePersistedIdentity = resolve;
    });
    const applyPendingLogin = delayedRead.then((currentIdentity) =>
      commitForCurrentAuthSession(guard, currentIdentity, () => {
        applied = true;
      })
    );

    beginAuthOperation();
    resolvePersistedIdentity(identity);

    await expect(applyPendingLogin).resolves.toBe(false);
    expect(applied).toBe(false);
  });
});
