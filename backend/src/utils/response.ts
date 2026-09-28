/**
 * 统一响应结构辅助函数
 * 成功: { success: true, data }
 * 失败: { success: false, error: { code, message, details } }
 */

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export function sendSuccess<T>(data: T): SuccessResponse<T> {
  return { success: true, data };
}

export function sendError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ErrorResponse {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}
