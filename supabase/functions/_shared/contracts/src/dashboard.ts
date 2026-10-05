import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";

export const DashboardOperationSchema = z.object({
  id: BusinessIdSchema,
  operatorName: z.string().max(128).nullable(),
  moduleCode: z.string().min(1).max(64),
  operationType: z.string().min(1).max(32),
  requestParams: z.unknown().nullable(),
  operationResult: z.union([z.literal(0), z.literal(1)]),
  operatedAt: z.string().datetime({ offset: true })
}).strict();

export const DashboardMessageSchema = z.object({
  id: BusinessIdSchema,
  title: z.string().min(1).max(128),
  summary: z.string().max(255).nullable(),
  messageType: z.string().min(1).max(32),
  readStatus: z.boolean(),
  sentAt: z.string().datetime({ offset: true })
}).strict();

const MetricSchema = z.number().int().nonnegative().nullable();
export const DashboardStatsSchema = z.object({
  userCount: MetricSchema,
  roleCount: MetricSchema,
  menuCount: MetricSchema,
  todayLoginCount: MetricSchema,
  apiErrorCount: MetricSchema
}).strict();

export const DashboardOverviewSchema = z.object({
  todoCount: z.number().int().nonnegative(),
  unreadMessageCount: z.number().int().nonnegative(),
  todoMessages: z.array(DashboardMessageSchema).max(5),
  recentOperations: z.array(DashboardOperationSchema).max(5),
  recentMessages: z.array(DashboardMessageSchema).max(5),
  adminStats: DashboardStatsSchema.nullable()
}).strict();

export type DashboardOperation = z.infer<typeof DashboardOperationSchema>;
export type DashboardMessage = z.infer<typeof DashboardMessageSchema>;
export type DashboardStats = z.infer<typeof DashboardStatsSchema>;
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;
