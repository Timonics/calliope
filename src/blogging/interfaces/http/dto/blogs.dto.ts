import { z } from 'zod';
import { paginationQuerySchema } from '../../../application/pagination';

/**
 * DTOs follow the workspace convention (see zod-validation.pipe.ts):
 * a class carrying a static `schema` zod field — the global pipe
 * discovers and parses it, so controllers never parse manually.
 */

export const slugField = z
  .string()
  .min(1)
  .max(200)
  .transform((value) => value.trim())
  .optional();

export class CreateBlogDto {
  public static readonly schema = z.object({
    name: z.string().min(1).max(200),
    slug: slugField,
  });

  public name!: string;
  public slug?: string;
}

export class ListBlogsQueryDto {
  public static readonly schema = paginationQuerySchema;

  public page!: number;
  public pageSize!: number;
}
