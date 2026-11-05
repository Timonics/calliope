import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { rethrowMapped } from './prisma-errors';
import { resolveCreateSlug } from '../domain/slug';

/**
 * Series read shape — the article include must match what the public
 * projection expects (author/category/series/tags).
 */
const SERIES_ARTICLE_INCLUDE = {
  author: true,
  category: true,
  series: true,
  tags: { orderBy: { name: 'asc' as const } },
} satisfies Prisma.ArticleInclude;

type SeriesArticle = Prisma.ArticleGetPayload<{
  include: typeof SERIES_ARTICLE_INCLUDE;
}>;

export interface CreateSeriesInput {
  name: string;
  slug?: string;
}

@Injectable()
export class SeriesService {
  public constructor(private readonly prisma: PrismaService) {}

  /** Management create — `content:write` scoped, tenant-guarded. */
  public async create(blogId: string, orgId: string, input: CreateSeriesInput) {
    await assertBlogAccess(this.prisma, blogId, orgId);
    const slug = await resolveCreateSlug({
      provided: input.slug,
      source: input.name,
      fallback: 'series',
      isTaken: async (s) =>
        (await this.prisma.series.findUnique({
          where: { blogId_slug: { blogId, slug: s } },
          select: { id: true },
        })) !== null,
      conflictCode: 'series.conflict',
    });
    try {
      return await this.prisma.series.create({
        data: { id: randomUUID(), blogId, name: input.name, slug },
      });
    } catch (error) {
      rethrowMapped(error, 'series');
    }
  }

  /**
   * Public read by slug (§2b of the article contract). Published
   * articles only, ordered by `seriesPosition` (1-based; Postgres sorts
   * ASC with NULLs last, and the membership invariant keeps NULLs out
   * anyway). `meta.total` counts exactly the returned, published set.
   */
  public async getPublicBySlug(
    blogId: string,
    slug: string,
  ): Promise<{
    series: { id: string; name: string; slug: string };
    articles: SeriesArticle[];
  }> {
    await getBlogOr404(this.prisma, blogId);
    const series = await this.prisma.series.findUnique({
      where: { blogId_slug: { blogId, slug } },
      select: { id: true, name: true, slug: true },
    });
    if (!series) {
      throw new DomainError(
        'series.not_found',
        `No series with slug "${slug}" in blog ${blogId}`,
      );
    }
    const articles = await this.prisma.article.findMany({
      where: { blogId, seriesId: series.id, status: 'PUBLISHED' },
      include: SERIES_ARTICLE_INCLUDE,
      orderBy: [
        { seriesPosition: 'asc' },
        { publishedAt: 'asc' },
        { id: 'asc' },
      ],
    });
    return { series, articles };
  }
}
