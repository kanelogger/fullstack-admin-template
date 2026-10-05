import { z } from "zod";

const postgresBigintMax = 9_223_372_036_854_775_807n;

/** Keep BIGINT identifiers as decimal strings so JavaScript cannot round them. */
export const BusinessIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "Expected a positive decimal BIGINT identifier")
  .refine(value => BigInt(value) <= postgresBigintMax, {
    message: "Identifier exceeds the PostgreSQL BIGINT range"
  });

export type BusinessId = z.infer<typeof BusinessIdSchema>;
