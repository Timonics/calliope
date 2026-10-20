import { z } from 'zod';
import { paginationQuerySchema } from '../../../application/pagination';

export class CreateAuthorDto {
  public static readonly schema = z.object({
    name: z.string().min(1).max(200),
    bio: z.string().max(5000).optional(),
    avatarUrl: z.url().optional(),
  });

  public name!: string;
  public bio?: string;
  public avatarUrl?: string;
}

export class UpdateAuthorDto {
  public static readonly schema = CreateAuthorDto.schema.partial();

  public name?: string;
  public bio?: string;
  public avatarUrl?: string;
}

export class ListAuthorsQueryDto {
  public static readonly schema = paginationQuerySchema;

  public page!: number;
  public pageSize!: number;
}
