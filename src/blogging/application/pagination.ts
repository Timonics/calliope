import { z } from 'zod';

/**
 * Offset pagination shared by every list endpoint: `page` (1-based)
 * and `pageSize` (max 100). Coercion lives in the zod schema so query
 * strings arrive typed; the pipe validates any DTO carrying a static
 * `schema`.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function toPage(query: PaginationQuery): {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
} {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function listEnvelope<T>(
  data: T[],
  total: number,
  page: { page: number; pageSize: number },
): { data: T[]; meta: { total: number; page: number; pageSize: number } } {
  return { data, meta: { total, page: page.page, pageSize: page.pageSize } };
}
