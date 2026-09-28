/**
 * 统一错误码与 HTTP 状态码映射
 * 所有业务错误必须使用 AppError 抛出，由全局错误处理器统一序列化
 */
export const ErrorCodes = {
  BAD_REQUEST: { code: "BAD_REQUEST", statusCode: 400 },
  UNAUTHORIZED: { code: "UNAUTHORIZED", statusCode: 401 },
  FORBIDDEN: { code: "FORBIDDEN", statusCode: 403 },
  NOT_FOUND: { code: "NOT_FOUND", statusCode: 404 },
  CONFLICT: { code: "CONFLICT", statusCode: 409 },
  VALIDATION_ERROR: { code: "VALIDATION_ERROR", statusCode: 422 },
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", statusCode: 500 },
  USER_DISABLED: { code: "USER_DISABLED", statusCode: 403 },
  INVALID_CREDENTIALS: { code: "INVALID_CREDENTIALS", statusCode: 401 },
  ROLE_IN_USE: { code: "ROLE_IN_USE", statusCode: 409 },
  DEPARTMENT_IN_USE: { code: "DEPARTMENT_IN_USE", statusCode: 409 },
  POST_IN_USE: { code: "POST_IN_USE", statusCode: 409 },
  UNSUPPORTED_PREVIEW_TYPE: { code: "UNSUPPORTED_PREVIEW_TYPE", statusCode: 400 },
  INVALID_OLD_PASSWORD: { code: "INVALID_OLD_PASSWORD", statusCode: 422 },
  PASSWORD_CONFIRM_MISMATCH: { code: "PASSWORD_CONFIRM_MISMATCH", statusCode: 422 },
  PASSWORD_UNCHANGED: { code: "PASSWORD_UNCHANGED", statusCode: 422 },
} as const;

export type ErrorCodeKey = keyof typeof ErrorCodes;

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    errorKey: ErrorCodeKey,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.code = ErrorCodes[errorKey].code;
    this.statusCode = ErrorCodes[errorKey].statusCode;
    this.details = details;

    // 保留原型链，方便 instanceof 判断
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * 通用业务断言
 */
export function assertCondition(
  condition: boolean,
  errorKey: ErrorCodeKey,
  message: string,
  details?: Record<string, unknown>
): asserts condition {
  if (!condition) {
    throw new AppError(errorKey, message, details);
  }
}
