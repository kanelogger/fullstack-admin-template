import { z } from "zod";
import { BusinessIdSchema } from "./ids";
import { createPaginatedResultSchema } from "./pagination";

export const AuditResultSchema = z.union([z.literal(0), z.literal(1)]);
const TimestampSchema = z.string().datetime({ offset: true });
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Expected a valid YYYY-MM-DD date");

function dateRange<T extends z.ZodRawShape>(shape: T) {
  return z.object({
    ...shape,
    startAt: DateSchema.optional(),
    endAt: DateSchema.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(10)
  }).strict().superRefine((input, context) => {
    const request = input as { startAt?: string; endAt?: string };
    if (request.startAt && request.endAt && request.startAt > request.endAt) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "End date must be on or after the start date"
      });
    }
  });
}

export const LoginLogSchema = z.object({
  id: BusinessIdSchema,
  userId: BusinessIdSchema.nullable(),
  loginName: z.string().min(1).max(64),
  loginIp: z.string().max(64).nullable(),
  userAgent: z.string().max(512).nullable(),
  loginResult: AuditResultSchema,
  failureReason: z.string().max(255).nullable(),
  loggedAt: TimestampSchema
}).strict();

export const OperationLogSchema = z.object({
  id: BusinessIdSchema,
  operatorId: BusinessIdSchema.nullable(),
  operatorName: z.string().max(128).nullable(),
  moduleCode: z.string().min(1).max(64),
  operationType: z.string().min(1).max(32),
  requestMethod: z.string().min(1).max(16),
  requestPath: z.string().min(1).max(255),
  requestParams: z.unknown().nullable(),
  operationResult: AuditResultSchema,
  errorMessage: z.string().nullable(),
  operatedAt: TimestampSchema
}).strict();

export const ExceptionLogSchema = z.object({
  id: BusinessIdSchema,
  requestPath: z.string().min(1).max(255),
  requestMethod: z.string().min(1).max(16),
  errorType: z.string().min(1).max(128),
  errorMessage: z.string(),
  stackSummary: z.string().nullable(),
  handledStatus: AuditResultSchema,
  occurredAt: TimestampSchema
}).strict();

export const LoginLogListRequestSchema = dateRange({
  loginName: z.string().trim().max(64).optional(),
  loginResult: AuditResultSchema.optional()
});

export const OperationLogListRequestSchema = dateRange({
  operatorName: z.string().trim().max(128).optional(),
  moduleCode: z.string().trim().max(64).optional(),
  operationType: z.string().trim().max(32).optional(),
  operationResult: AuditResultSchema.optional()
});

export const ExceptionLogListRequestSchema = dateRange({
  requestPath: z.string().trim().max(255).optional(),
  errorType: z.string().trim().max(128).optional(),
  handledStatus: AuditResultSchema.optional()
});

export const LoginLogPageSchema = createPaginatedResultSchema(LoginLogSchema);
export const OperationLogPageSchema = createPaginatedResultSchema(OperationLogSchema);
export const ExceptionLogPageSchema = createPaginatedResultSchema(ExceptionLogSchema);

export type LoginLog = z.infer<typeof LoginLogSchema>;
export type OperationLog = z.infer<typeof OperationLogSchema>;
export type ExceptionLog = z.infer<typeof ExceptionLogSchema>;
export type LoginLogListRequest = z.infer<typeof LoginLogListRequestSchema>;
export type OperationLogListRequest = z.infer<typeof OperationLogListRequestSchema>;
export type ExceptionLogListRequest = z.infer<typeof ExceptionLogListRequestSchema>;
export type LoginLogPage = z.infer<typeof LoginLogPageSchema>;
export type OperationLogPage = z.infer<typeof OperationLogPageSchema>;
export type ExceptionLogPage = z.infer<typeof ExceptionLogPageSchema>;
