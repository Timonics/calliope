import { z } from 'zod';
import { paginationQuerySchema } from '../../../application/pagination';
import { slugField } from './blogs.dto';

export class CreateTagDto {
  public static readonly schema = z.object({
    name: z.string().min(1).max(200),
    slug: slugField,
  });

  public name!: string;
  public slug?: string;
}

export class UpdateTagDto {
  public static readonly schema = CreateTagDto.schema.partial();

  public name?: string;
  public slug?: string;
}

export class ListTagsQueryDto {
  public static readonly schema = paginationQuerySchema;

  public page!: number;
  public pageSize!: number;
}
