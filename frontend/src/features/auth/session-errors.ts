import { isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

export class AuthSessionRejectedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AuthSessionRejectedError";
  }
}

/** PostgREST omits HTTP status from its error object; codes 301-303 are JWT/authentication rejections. */
export function isExplicitAuthRejection(error: unknown, responseStatus?: number): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { code?: unknown; status?: unknown };
  const status = typeof detail.status === "number" ? detail.status : responseStatus;
  return (
    status === 401 ||
    status === 403 ||
    (typeof detail.code === "string" && /^PGRST30[1-3]$/.test(detail.code)) ||
    detail.code === "28000"
  );
}

export function isAuthSessionRejectedError(error: unknown): error is AuthSessionRejectedError {
  return error instanceof AuthSessionRejectedError;
}

/** Keep the last verified UI session only for failures that do not invalidate Auth. */
export function isTransientAuthSessionError(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  if (isAuthError(error) && (error.status === undefined || error.status >= 500)) return true;
  if (!error || typeof error !== "object") return false;
  const detail = error as { code?: unknown; status?: unknown };
  if (
    typeof detail.status === "number" &&
    (detail.status === 0 || (detail.status >= 500 && detail.status < 600))
  )
    return true;
  return (
    typeof detail.code === "string" &&
    (/^PGRST00[0-3]$/.test(detail.code) || detail.code === "PGRSTX00")
  );
}
