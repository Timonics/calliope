import { z } from 'zod';
import { paginationQuerySchema } from '../../../application/pagination';
import { slugField } from './blogs.dto';
import { articleContentSchema } from '../../../application/article-content.schema';
import { MAX_RELATED_ARTICLES } from '../../../domain/related-articles';

const articleStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

const uuidArray = (max?: number): z.ZodType<string[]> =>
  max === undefined
    ? z.array(z.uuid())
    : z.array(z.uuid()).max(max, `at most ${max} entries`);

export class CreateArticleDto {
  public static readonly schema = z.object({
    title: z.string().min(1).max(300),
    slug: slugField,
    excerpt: z.string().max(1000).optional(),
    content: articleContentSchema,
    coverImageUrl: z.url().optional(),
    authorId: z.uuid(),
    categoryId: z.uuid().optional(),
    tagIds: uuidArray().optional(),
    status: articleStatusSchema.optional(),
    relatedArticleIds: uuidArray(MAX_RELATED_ARTICLES).optional(),
  });

  public title!: string;
  public slug?: string;
  public excerpt?: string;
  public content!: unknown;
  public coverImageUrl?: string;
  public authorId!: string;
  public categoryId?: string;
  public tagIds?: string[];
  public status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  public relatedArticleIds?: string[];
}

export class UpdateArticleDto {
  public static readonly schema = CreateArticleDto.schema
    .omit({ content: true })
    .extend({ content: articleContentSchema.optional() })
    .partial();

  public title?: string;
  public slug?: string;
  public excerpt?: string;
  public content?: unknown;
  public coverImageUrl?: string;
  public authorId?: string;
  public categoryId?: string;
  public tagIds?: string[];
  public status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  public relatedArticleIds?: string[];
}

/**
 * Shared by the management and public article list routes. The
 * `status` filter is management-only: the public handler ignores it
 * (everything there is PUBLISHED by construction).
 */
export class ListArticlesQueryDto {
  public static readonly schema = paginationQuerySchema.extend({
    status: articleStatusSchema.optional(),
    authorId: z.uuid().optional(),
    categoryId: z.uuid().optional(),
    tagId: z.uuid().optional(),
    q: z.string().max(300).optional(),
  });

  public page!: number;
  public pageSize!: number;
  public status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  public authorId?: string;
  public categoryId?: string;
  public tagId?: string;
  public q?: string;
}

export class GetArticleQueryDto {
  public static readonly schema = z.object({
    include: z.literal('related').optional(),
  });

  public include?: 'related';
}
