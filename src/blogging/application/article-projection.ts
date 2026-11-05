import type { Prisma } from '@prisma/client';

/**
 * Public article shape — the whitelist projection served by the
 * `@Public()` read routes, matching the extended article contract:
 *
 *   * Everything internal stays server-side: `blogId`, foreign keys
 *     (`authorId`/`categoryId`/`seriesId`), `status` (always PUBLISHED
 *     on these routes anyway), `relatedArticleIds` (raw curated id
 *     list), `seriesPosition` (folded into `series.position`) and
 *     `version`.
 *   * `series.total` is the count of PUBLISHED articles in the series —
 *     the service passes a `seriesTotals` map (one groupBy per
 *     response) because a projection must stay a pure function.
 *   * JSON columns (`coverImage`, `corrections`, `seo`, author `links`)
 *     are normalized here: defaults applied (`noIndex: false`, empty
 *     arrays), malformed rows degrade to the default instead of
 *     crashing the renderer.
 *   * `coverImageUrl` is the legacy mirror of `coverImage.url`, kept in
 *     sync on writes by the service layer.
 */
export interface PublicAuthorLink {
  label: string;
  url: string;
}

export interface PublicAuthor {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  links: PublicAuthorLink[];
}

export interface PublicTaxonomy {
  id: string;
  name: string;
  slug: string;
}

export interface PublicCategory extends PublicTaxonomy {
  description: string | null;
}

export interface PublicCoverImage {
  url: string;
  alt: string;
  caption: string | null;
  credit: string | null;
  width: number;
  height: number;
}

export interface PublicCorrection {
  date: string;
  note: string;
}

export interface PublicSeo {
  socialImageUrl: string | null;
  socialTitle: string | null;
  socialDescription: string | null;
  noIndex: boolean;
}

export interface PublicSeries {
  id: string;
  name: string;
  slug: string;
  /** 1-based position of THIS article within the series. */
  position: number;
  /** Published-article count in the series (service-computed). */
  total: number;
}

export interface PublicArticle {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  content: unknown;
  coverImage: PublicCoverImage | null;
  coverImageUrl: string | null;
  featured: boolean;
  series: PublicSeries | null;
  readingTimeMinutes: number | null;
  publishedAt: Date | null;
  /** Real modification time (Prisma `@updatedAt`). */
  updatedAt: Date;
  canonicalUrl: string | null;
  locale: string;
  corrections: PublicCorrection[];
  seo: PublicSeo;
  author: PublicAuthor;
  category: PublicCategory | null;
  tags: PublicTaxonomy[];
  /** present only on the slug detail route with `?include=related`. */
  related?: PublicArticle[];
}

type ArticleWithRelations = Prisma.ArticleGetPayload<{
  include: { author: true; category: true; series: true; tags: true };
}>;

export function toPublicArticle(
  article: ArticleWithRelations,
  seriesTotals: ReadonlyMap<string, number>,
  related?: ArticleWithRelations[],
): PublicArticle {
  const seo = asObject(article.seo);
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    subtitle: article.subtitle,
    excerpt: article.excerpt,
    content: article.content,
    // Published articles passed the publish gate, so a stored coverImage
    // is contract-complete; the cast reflects the DTO write shape.
    coverImage:
      article.coverImage === null
        ? null
        : (article.coverImage as unknown as PublicCoverImage),
    coverImageUrl: article.coverImageUrl,
    featured: article.featured,
    series:
      article.series === null
        ? null
        : {
            id: article.series.id,
            name: article.series.name,
            slug: article.series.slug,
            position: article.seriesPosition ?? 0,
            total: seriesTotals.get(article.series.id) ?? 0,
          },
    readingTimeMinutes: article.readingTimeMinutes,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    canonicalUrl: article.canonicalUrl,
    locale: article.locale,
    corrections: asArray(article.corrections) as PublicCorrection[],
    seo: {
      socialImageUrl: asNullableString(seo.socialImageUrl),
      socialTitle: asNullableString(seo.socialTitle),
      socialDescription: asNullableString(seo.socialDescription),
      noIndex: seo.noIndex === true,
    },
    author: {
      id: article.author.id,
      name: article.author.name,
      bio: article.author.bio,
      avatarUrl: article.author.avatarUrl,
      links: asArray(article.author.links) as PublicAuthorLink[],
    },
    category:
      article.category === null
        ? null
        : {
            id: article.category.id,
            name: article.category.name,
            slug: article.category.slug,
            description: article.category.description,
          },
    tags: article.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
    })),
    ...(related === undefined
      ? {}
      : { related: related.map((r) => toPublicArticle(r, seriesTotals)) }),
  };
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function asArray(value: Prisma.JsonValue): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
