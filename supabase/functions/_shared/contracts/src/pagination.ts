import { z } from "zod";

export const PaginationRequestSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20)
  })
  .strict();

export function createPaginatedResultSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      items: z.array(itemSchema),
      total: z.number().int().nonnegative(),
      page: z.number().int().min(1),
      pageSize: z.number().int().min(1).max(100)
    })
    .strict();
}

export type PaginationRequest = z.infer<typeof PaginationRequestSchema>;
