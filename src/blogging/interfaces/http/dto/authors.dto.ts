import { z } from 'zod';
import { paginationQuerySchema } from '../../../application/pagination';

export const authorLinkSchema = z.object({
  label: z.string().min(1).max(100),
  url: z.url(),
});

export class CreateAuthorDto {
  public static readonly schema = z.object({
    name: z.string().min(1).max(200),
    bio: z.string().max(5000).nullable().optional(),
    avatarUrl: z.url().nullable().optional(),
    links: z.array(authorLinkSchema).max(20).nullable().optional(),
  });

  public name!: string;
  public bio?: string | null;
  public avatarUrl?: string | null;
  public links?: Array<{ label: string; url: string }> | null;
}

/** PATCH: `null` clears the column, absent keeps the current value. */
export class UpdateAuthorDto {
  public static readonly schema = CreateAuthorDto.schema.partial();

  public name?: string;
  public bio?: string | null;
  public avatarUrl?: string | null;
  public links?: Array<{ label: string; url: string }> | null;
}

export class ListAuthorsQueryDto {
  public static readonly schema = paginationQuerySchema;

  public page!: number;
  public pageSize!: number;
}
