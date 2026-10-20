import { z } from 'zod';
import { paginationQuerySchema } from '../../../application/pagination';
import { slugField } from './blogs.dto';
import { articleContentSchema } from '../../../application/article-content.schema';
import { MAX_RELATED_ARTICLES } from '../../../domain/related-articles';

const articleStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

const MAX_TAG_IDS_PER_ARTICLE = 50;

const uuidArray = (max?: number): z.ZodType<string[]> =>
  max === undefined
    ? z.array(z.uuid())
    : z.array(z.uuid()).max(max, `at most ${max} entries`);

export class CreateArticleDto {
  public static readonly schema = z.object({
    /**
     * Optional client-supplied UUID. Idempotency primitive: a replayed
     * create with the same id returns the existing article (200) instead
     * of inserting a duplicate — see ArticlesService.create.
     */
    id: z.uuid().optional(),
    title: z.string().min(1).max(300),
    slug: slugField,
    excerpt: z.string().max(1000).nullable().optional(),
    content: articleContentSchema,
    coverImageUrl: z.url().nullable().optional(),
    authorId: z.uuid(),
    categoryId: z.uuid().nullable().optional(),
    tagIds: uuidArray(MAX_TAG_IDS_PER_ARTICLE).optional(),
    status: articleStatusSchema.optional(),
    relatedArticleIds: uuidArray(MAX_RELATED_ARTICLES).optional(),
  });

  public id?: string;
  public title!: string;
  public slug?: string;
  public excerpt?: string | null;
  public content!: unknown;
  public coverImageUrl?: string | null;
  public authorId!: string;
  public categoryId?: string | null;
  public tagIds?: string[];
  public status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  public relatedArticleIds?: string[];
}

/**
 * PATCH semantics: every nullable field accepts explicit `null`, which
 * CLEARS the column (`undefined`/`absent` keeps the current value).
 * zod `.partial()` preserves the `.nullable()` wrapping of the create
 * schema (verified: `safeParse({ excerpt: null })` succeeds).
 */
export class UpdateArticleDto {
  public static readonly schema = CreateArticleDto.schema
    .omit({ content: true })
    .extend({
      content: articleContentSchema.optional(),
      /**
       * Optimistic-locking expectation: when present, the update fails
       * with 409 `article.conflict` if the row's `version` has moved on.
       * The `If-Match` request header is an alternative carrier.
       */
      version: z.number().int().min(0).optional(),
    })
    .partial();

  public title?: string;
  public slug?: string;
  public excerpt?: string | null;
  public content?: unknown;
  public coverImageUrl?: string | null;
  public authorId?: string;
  public categoryId?: string | null;
  public tagIds?: string[];
  public status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  public relatedArticleIds?: string[];
  public version?: number;
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
