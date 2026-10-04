import {
  ExceptionLogListRequestSchema,
  ExceptionLogPageSchema,
  ExceptionLogSchema,
  LoginLogListRequestSchema,
  LoginLogPageSchema,
  LoginLogSchema,
  OperationLogListRequestSchema,
  OperationLogPageSchema,
  OperationLogSchema,
  BusinessIdSchema,
  type ExceptionLog,
  type ExceptionLogPage,
  type LoginLog,
  type LoginLogPage,
  type OperationLog,
  type OperationLogPage
} from "@/contracts";
import { getSupabaseClient } from "@/shared/supabase/client";

type Row = Record<string, unknown>;

function failure(message: string): Error {
  return new Error(message);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function startOfUtcDay(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toISOString();
}

function startOfNextUtcDay(day: string): string {
  const next = new Date(startOfUtcDay(day));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function mapLoginLog(value: unknown): LoginLog {
  if (!value || typeof value !== "object") throw failure("登录日志数据格式无效");
  const row = value as Row;
  return LoginLogSchema.parse({
    id: row.id,
    userId: row.user_id,
    loginName: row.login_name,
    loginIp: row.login_ip,
    userAgent: row.user_agent,
    loginResult: Number(row.login_result),
    failureReason: row.failure_reason,
    loggedAt: row.logged_at
  });
}

function mapOperationLog(value: unknown): OperationLog {
  if (!value || typeof value !== "object") throw failure("操作日志数据格式无效");
  const row = value as Row;
  return OperationLogSchema.parse({
    id: row.id,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    moduleCode: row.module_code,
    operationType: row.operation_type,
    requestMethod: row.request_method,
    requestPath: row.request_path,
    requestParams: row.request_params,
    operationResult: Number(row.operation_result),
    errorMessage: row.error_message,
    operatedAt: row.operated_at
  });
}

function mapExceptionLog(value: unknown): ExceptionLog {
  if (!value || typeof value !== "object") throw failure("异常日志数据格式无效");
  const row = value as Row;
  return ExceptionLogSchema.parse({
    id: row.id,
    requestPath: row.request_path,
    requestMethod: row.request_method,
    errorType: row.error_type,
    errorMessage: row.error_message,
    stackSummary: row.stack_summary,
    handledStatus: Number(row.handled_status),
    occurredAt: row.occurred_at
  });
}

function applyDateRange<T extends { gte: (column: string, value: string) => T; lt: (column: string, value: string) => T }>(
  query: T,
  column: string,
  startAt?: string,
  endAt?: string
): T {
  let result = query;
  if (startAt) result = result.gte(column, startOfUtcDay(startAt));
  if (endAt) result = result.lt(column, startOfNextUtcDay(endAt));
  return result;
}

export async function getLoginLogs(input: unknown = {}): Promise<LoginLogPage> {
  const request = LoginLogListRequestSchema.parse(input);
  let query = getSupabaseClient()
    .from("login_log_read_model")
    .select("id, user_id, login_name, login_ip, user_agent, login_result, failure_reason, logged_at", { count: "exact" });
  if (request.loginName) query = query.ilike("login_name", `%${escapeLike(request.loginName)}%`);
  if (request.loginResult !== undefined) query = query.eq("login_result", request.loginResult);
  query = applyDateRange(query, "logged_at", request.startAt, request.endAt);
  const from = (request.page - 1) * request.pageSize;
  const { data, count, error } = await query
    .order("logged_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + request.pageSize - 1);
  if (error) throw failure("登录日志加载失败或当前账号无读取权限");
  return LoginLogPageSchema.parse({
    items: (data ?? []).map(mapLoginLog),
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize
  });
}

export async function getLoginLog(idInput: unknown): Promise<LoginLog> {
  const id = BusinessIdSchema.parse(idInput);
  const { data, error } = await getSupabaseClient()
    .from("login_log_read_model")
    .select("id, user_id, login_name, login_ip, user_agent, login_result, failure_reason, logged_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw failure("登录日志不存在或当前账号无读取权限");
  return mapLoginLog(data);
}

export async function getOperationLogs(input: unknown = {}): Promise<OperationLogPage> {
  const request = OperationLogListRequestSchema.parse(input);
  let query = getSupabaseClient()
    .from("operation_log_read_model")
    .select("id, operator_id, operator_name, module_code, operation_type, request_method, request_path, request_params, operation_result, error_message, operated_at", { count: "exact" });
  if (request.operatorName) query = query.ilike("operator_name", `%${escapeLike(request.operatorName)}%`);
  if (request.moduleCode) query = query.eq("module_code", request.moduleCode);
  if (request.operationType) query = query.eq("operation_type", request.operationType);
  if (request.operationResult !== undefined) query = query.eq("operation_result", request.operationResult);
  query = applyDateRange(query, "operated_at", request.startAt, request.endAt);
  const from = (request.page - 1) * request.pageSize;
  const { data, count, error } = await query
    .order("operated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + request.pageSize - 1);
  if (error) throw failure("操作日志加载失败或当前账号无读取权限");
  return OperationLogPageSchema.parse({
    items: (data ?? []).map(mapOperationLog),
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize
  });
}

export async function getOperationLog(idInput: unknown): Promise<OperationLog> {
  const id = BusinessIdSchema.parse(idInput);
  const { data, error } = await getSupabaseClient()
    .from("operation_log_read_model")
    .select("id, operator_id, operator_name, module_code, operation_type, request_method, request_path, request_params, operation_result, error_message, operated_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw failure("操作日志不存在或当前账号无读取权限");
  return mapOperationLog(data);
}

export async function getExceptionLogs(input: unknown = {}): Promise<ExceptionLogPage> {
  const request = ExceptionLogListRequestSchema.parse(input);
  let query = getSupabaseClient()
    .from("exception_log_read_model")
    .select("id, request_path, request_method, error_type, error_message, stack_summary, handled_status, occurred_at", { count: "exact" });
  if (request.requestPath) query = query.ilike("request_path", `%${escapeLike(request.requestPath)}%`);
  if (request.errorType) query = query.ilike("error_type", `%${escapeLike(request.errorType)}%`);
  if (request.handledStatus !== undefined) query = query.eq("handled_status", request.handledStatus);
  query = applyDateRange(query, "occurred_at", request.startAt, request.endAt);
  const from = (request.page - 1) * request.pageSize;
  const { data, count, error } = await query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + request.pageSize - 1);
  if (error) throw failure("异常日志加载失败或当前账号无读取权限");
  return ExceptionLogPageSchema.parse({
    items: (data ?? []).map(mapExceptionLog),
    total: count ?? 0,
    page: request.page,
    pageSize: request.pageSize
  });
}

export async function getExceptionLog(idInput: unknown): Promise<ExceptionLog> {
  const id = BusinessIdSchema.parse(idInput);
  const { data, error } = await getSupabaseClient()
    .from("exception_log_read_model")
    .select("id, request_path, request_method, error_type, error_message, stack_summary, handled_status, occurred_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) throw failure("异常日志不存在或当前账号无读取权限");
  return mapExceptionLog(data);
}
