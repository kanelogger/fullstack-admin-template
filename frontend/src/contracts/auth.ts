import { z } from "zod";
import { BusinessIdSchema } from "./ids";
import { PermissionKeySchema, RoleCodeSchema } from "./permissions";
import { AppErrorSchema } from "./errors";

export const LoginRequestSchema = z
  .object({
    loginName: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(1024)
  })
  .strict();

export const PasswordResetRequestSchema = z
  .object({
    loginName: z.string().trim().min(1).max(64)
  })
  .strict();

export const ProfileSchema = z
  .object({
    id: BusinessIdSchema,
    authUserId: z.string().uuid(),
    loginName: z.string().min(1).max(64),
    displayName: z.string().min(1).max(128),
    email: z.string().email().max(320),
    phone: z.string().nullable(),
    avatarUrl: z.string().max(2048).nullable(),
    isActive: z.boolean()
  })
  .strict();

/** Safe application session data; Supabase access/refresh tokens stay in its Auth client. */
export const SessionSchema = z
  .object({
    profile: ProfileSchema,
    roleCodes: z.array(RoleCodeSchema),
    permissionKeys: z.array(PermissionKeySchema),
    mustResetPassword: z.boolean()
  })
  .strict();

export const SupabaseTokenPairSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresAt: z.number().int().positive()
  })
  .strict();

export const SessionLoginResponseSchema = z.discriminatedUnion("success", [
  z
    .object({
      success: z.literal(true),
      data: z
        .object({
          session: SessionSchema,
          tokens: SupabaseTokenPairSchema
        })
        .strict()
    })
    .strict(),
  z
    .object({
      success: z.literal(false),
      error: AppErrorSchema
    })
    .strict()
]);

export const PasswordResetCompletionRequestSchema = z
  .object({
    password: z.string().min(8).max(1024)
  })
  .strict();

export const PasswordResetResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    data: z.object({ message: z.string().min(1) }).strict()
  }).strict(),
  z.object({
    success: z.literal(false),
    error: AppErrorSchema
  }).strict()
]);

export const LoginOutcomeSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    data: SessionSchema
  }).strict(),
  z.object({ success: z.literal(false), error: AppErrorSchema }).strict()
]);

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type SessionLoginResponse = z.infer<typeof SessionLoginResponseSchema>;
export type SupabaseTokenPair = z.infer<typeof SupabaseTokenPairSchema>;
export type LoginOutcome = z.infer<typeof LoginOutcomeSchema>;
export type PasswordResetResponse = z.infer<typeof PasswordResetResponseSchema>;
