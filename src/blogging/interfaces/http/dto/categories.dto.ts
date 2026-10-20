import { z } from 'zod';
import { paginationQuerySchema } from '../../../application/pagination';
import { slugField } from './blogs.dto';

export class CreateCategoryDto {
  public static readonly schema = z.object({
    name: z.string().min(1).max(200),
    slug: slugField,
    description: z.string().max(2000).optional(),
  });

  public name!: string;
  public slug?: string;
  public description?: string;
}

export class UpdateCategoryDto {
  public static readonly schema = CreateCategoryDto.schema.partial();

  public name?: string;
  public slug?: string;
  public description?: string;
}

export class ListCategoriesQueryDto {
  public static readonly schema = paginationQuerySchema;

  public page!: number;
  public pageSize!: number;
}
