import { z } from "zod";

export const AppErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(2000),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const ErrorEnvelopeSchema = z
  .object({
    success: z.literal(false).optional(),
    error: AppErrorSchema
  })
  .strict();

export type AppError = z.infer<typeof AppErrorSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
