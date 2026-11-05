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

/**
 * Structured hero image — REQUIRED on publish (the service-layer gate
 * rejects the transition to PUBLISHED without it). `alt` is mandatory
 * for accessibility; `width`/`height` let renderers reserve layout space
 * before the image loads.
 */
export const coverImageSchema = z.object({
  url: z.url(),
  alt: z.string().min(1).max(500),
  caption: z.string().max(1000).nullable().optional(),
  credit: z.string().max(500).nullable().optional(),
  width: z.number().int().positive().max(100_000),
  height: z.number().int().positive().max(100_000),
});

export type CoverImage = z.infer<typeof coverImageSchema>;

/** Visible editorial record entry (chronological, rendered as a banner). */
const correctionSchema = z.object({
  date: z.iso.datetime(),
  note: z.string().min(1).max(2000),
});

/** Per-article SEO overrides; absent keys mean "no override". */
const seoSchema = z.object({
  socialImageUrl: z.url().nullable().optional(),
  socialTitle: z.string().max(300).nullable().optional(),
  socialDescription: z.string().max(500).nullable().optional(),
  noIndex: z.boolean().optional(),
});

export class CreateArticleDto {
  public static readonly schema = z.object({
    /**
     * Optional client-supplied UUID. Idempotency primitive: a replayed
     * create with the same id returns the existing article (200) instead
     * of inserting a duplicate — see ArticlesService.create.
     */
    id: z.uuid().optional(),
    title: z.string().min(1).max(300),
    subtitle: z.string().max(300).nullable().optional(),
    slug: slugField,
    excerpt: z.string().max(1000).nullable().optional(),
    content: articleContentSchema,
    coverImage: coverImageSchema.nullable().optional(),
    coverImageUrl: z.url().nullable().optional(),
    featured: z.boolean().optional(),
    seriesId: z.uuid().nullable().optional(),
    seriesPosition: z.number().int().min(1).nullable().optional(),
    readingTimeMinutes: z.number().int().min(0).nullable().optional(),
    canonicalUrl: z.url().nullable().optional(),
    locale: z.string().min(2).max(35).optional(),
    corrections: z.array(correctionSchema).max(50).optional(),
    seo: seoSchema.optional(),
    authorId: z.uuid(),
    categoryId: z.uuid().nullable().optional(),
    tagIds: uuidArray(MAX_TAG_IDS_PER_ARTICLE).optional(),
    status: articleStatusSchema.optional(),
    relatedArticleIds: uuidArray(MAX_RELATED_ARTICLES).optional(),
  });

  public id?: string;
  public title!: string;
  public subtitle?: string | null;
  public slug?: string;
  public excerpt?: string | null;
  public content!: unknown;
  public coverImage?: CoverImage | null;
  public coverImageUrl?: string | null;
  public featured?: boolean;
  public seriesId?: string | null;
  public seriesPosition?: number | null;
  public readingTimeMinutes?: number | null;
  public canonicalUrl?: string | null;
  public locale?: string;
  public corrections?: Array<{ date: string; note: string }>;
  public seo?: z.infer<typeof seoSchema>;
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
  public subtitle?: string | null;
  public slug?: string;
  public excerpt?: string | null;
  public content?: unknown;
  public coverImage?: CoverImage | null;
  public coverImageUrl?: string | null;
  public featured?: boolean;
  public seriesId?: string | null;
  public seriesPosition?: number | null;
  public readingTimeMinutes?: number | null;
  public canonicalUrl?: string | null;
  public locale?: string;
  public corrections?: Array<{ date: string; note: string }>;
  public seo?: z.infer<typeof seoSchema>;
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
