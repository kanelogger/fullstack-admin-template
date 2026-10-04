import { z } from "npm:zod@4.6.5";

export const LoginRequestSchema = z.object({
  loginName: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(1024)
}).strict();

export const PasswordResetRequestSchema = z.object({
  loginName: z.string().trim().min(1).max(64)
}).strict();

export const LoginIdentitySchema = z.object({
  authUserId: z.string().uuid(),
  id: z.string().regex(/^[1-9]\d*$/),
  loginName: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128),
  email: z.string().email().max(320),
  phone: z.string().nullable(),
  avatarUrl: z.string().max(2048).nullable(),
  isActive: z.boolean(),
  mustResetPassword: z.boolean(),
  roleCodes: z.array(z.string()),
  permissionKeys: z.array(z.string())
}).strict();

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;
export type LoginIdentity = z.infer<typeof LoginIdentitySchema>;
