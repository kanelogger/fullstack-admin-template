import {
  isAuthError,
  isAuthRetryableFetchError
} from "@supabase/supabase-js";

/** Keep the last verified UI session only for failures that do not invalidate Auth. */
export function isTransientAuthSessionError(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  return isAuthError(error) && (error.status === undefined || error.status >= 500);
}
