const authSessionLockName = "fullstack-admin-template:supabase-auth-session";

/** Serialize app-initiated Auth session writes across browser tabs. */
export function withAuthSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    return Promise.reject(
      new Error("This browser does not support safe cross-tab Auth session updates.")
    );
  }
  // The DOM lib types the Web Locks callback as synchronous, while Chromium
  // holds the lock until a returned Promise settles.
  const asyncLocks = navigator.locks as unknown as {
    request<R>(
      name: string,
      options: LockOptions,
      callback: (lock: Lock | null) => Promise<R>
    ): Promise<R>;
  };
  return asyncLocks.request(authSessionLockName, { mode: "exclusive" }, operation);
}
