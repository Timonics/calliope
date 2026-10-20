import type { Prisma } from '@prisma/client';

/**
 * Public article shape — the whitelist projection served by the
 * `@Public()` read routes. Everything internal stays server-side:
 * `blogId`, foreign keys (`authorId`/`categoryId`), `status` (always
 * PUBLISHED on these routes anyway), `relatedArticleIds` (raw curated
 * id list), and the `createdAt`/`updatedAt` housekeeping timestamps.
 */
export interface PublicAuthor {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
}

export interface PublicTaxonomy {
  id: string;
  name: string;
  slug: string;
}

export interface PublicArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: unknown;
  coverImageUrl: string | null;
  publishedAt: Date | null;
  author: PublicAuthor;
  category: PublicTaxonomy | null;
  tags: PublicTaxonomy[];
  /** present only on the slug detail route with `?include=related`. */
  related?: PublicArticle[];
}

type ArticleWithRelations = Prisma.ArticleGetPayload<{
  include: { author: true; category: true; tags: true };
}>;

export function toPublicArticle(
  article: ArticleWithRelations,
  related?: ArticleWithRelations[],
): PublicArticle {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    content: article.content,
    coverImageUrl: article.coverImageUrl,
    publishedAt: article.publishedAt,
    author: {
      id: article.author.id,
      name: article.author.name,
      bio: article.author.bio,
      avatarUrl: article.author.avatarUrl,
    },
    category:
      article.category === null
        ? null
        : {
            id: article.category.id,
            name: article.category.name,
            slug: article.category.slug,
          },
    tags: article.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
    })),
    ...(related === undefined
      ? {}
      : { related: related.map((r) => toPublicArticle(r)) }),
  };
}
