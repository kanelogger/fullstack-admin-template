import { z } from "zod";
import { BusinessIdSchema } from "./ids.ts";

export const BootstrapAdminInputSchema = z.object({
  loginName: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(128),
  email: z.string().trim().email().max(320)
}).strict();

export const BootstrapAdminResultSchema = z.object({
  id: BusinessIdSchema,
  mustResetPassword: z.boolean(),
  initialized: z.literal(true)
}).strict();

export type BootstrapAdminInput = z.infer<typeof BootstrapAdminInputSchema>;
export type BootstrapAdminResult = z.infer<typeof BootstrapAdminResultSchema>;
