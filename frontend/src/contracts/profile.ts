import { z } from "zod";

export const ProfileUpdateRequestSchema = z
  .object({
    displayName: z.string().trim().min(1).max(128),
    phone: z.string().trim().max(32).nullable().transform(value => value || null)
  })
  .strict();

export type ProfileUpdateRequest = z.infer<typeof ProfileUpdateRequestSchema>;
