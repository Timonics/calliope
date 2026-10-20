import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Article, ArticleStatus, Prisma } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { isUuid } from './id.util';
import { rethrowMapped } from './prisma-errors';
import { resolveCreateSlug, resolveUpdateSlug } from '../domain/slug';
import { resolveStatusTransition } from '../domain/article-status';
import { validateRelatedArticleIds } from '../domain/related-articles';
import type { Page } from './blogs.service';

export interface CreateArticleInput {
  title: string;
  slug?: string;
  excerpt?: string;
  content: unknown; // validated upstream by articleContentSchema (DTO pipe)
  coverImageUrl?: string;
  authorId: string;
  categoryId?: string;
  tagIds?: string[];
  status?: ArticleStatus;
  relatedArticleIds?: string[];
}

export type UpdateArticleInput = Partial<CreateArticleInput>;

export interface ArticleListFilters {
  status?: ArticleStatus;
  authorId?: string;
  categoryId?: string;
  tagId?: string;
  /** case-insensitive contains on title/excerpt */
  q?: string;
}

const ARTICLE_INCLUDE = {
  author: true,
  category: true,
  tags: { orderBy: { name: 'asc' as const } },
} satisfies Prisma.ArticleInclude;

type ArticleWithRelations = Prisma.ArticleGetPayload<{
  include: typeof ARTICLE_INCLUDE;
}>;

@Injectable()
export class ArticlesService {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(
    blogId: string,
    orgId: string,
    input: CreateArticleInput,
  ): Promise<ArticleWithRelations> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    await this.assertAuthorInBlog(blogId, input.authorId);
    if (input.categoryId !== undefined) {
      await this.assertCategoryInBlog(blogId, input.categoryId);
    }
    const tagIds =
      input.tagIds === undefined
        ? undefined
        : await this.assertTagsInBlog(blogId, input.tagIds);
    const relatedIds =
      input.relatedArticleIds === undefined
        ? undefined
        : await this.validateRelated(blogId, input.relatedArticleIds);

    const slug = await resolveCreateSlug({
      provided: input.slug,
      source: input.title,
      fallback: 'article',
      isTaken: (s) => this.slugTaken(blogId, s),
      conflictCode: 'article.conflict',
    });

    const { status, publishedAt } = resolveStatusTransition(
      'DRAFT',
      input.status,
      null,
      new Date(),
    );

    try {
      return await this.prisma.article.create({
        data: {
          id: randomUUID(),
          blogId,
          authorId: input.authorId,
          categoryId: input.categoryId ?? null,
          title: input.title,
          slug,
          excerpt: input.excerpt,
          content: input.content as Prisma.InputJsonValue,
          coverImageUrl: input.coverImageUrl,
          status,
          publishedAt,
          relatedArticleIds: relatedIds ?? [],
          ...(tagIds === undefined
            ? {}
            : { tags: { connect: tagIds.map((id) => ({ id })) } }),
        },
        include: ARTICLE_INCLUDE,
      });
    } catch (error) {
      rethrowMapped(error, 'article');
    }
  }

  /** Management list — every status, extra `status` filter. */
  public async listManagement(
    blogId: string,
    orgId: string,
    filters: ArticleListFilters,
    page: Page,
  ): Promise<{ data: ArticleWithRelations[]; total: number }> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    return this.list(blogId, filters, page);
  }

  /** Public list — published only, always. */
  public async listPublic(
    blogId: string,
    filters: ArticleListFilters,
    page: Page,
  ): Promise<{ data: ArticleWithRelations[]; total: number }> {
    await getBlogOr404(this.prisma, blogId);
    return this.list(blogId, { ...filters, status: 'PUBLISHED' }, page);
  }

  public async getManagement(
    blogId: string,
    orgId: string,
    articleId: string,
  ): Promise<ArticleWithRelations> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    return this.mustExist(blogId, articleId);
  }

  /**
   * Public fetch by SLUG (public routes never expose internal ids in
   * their URLs). Drafts/archives are invisible here — a slug that
   * exists but is not published renders exactly like an unknown slug
   * (`article.not_found`, no leak).
   */
  public async getPublicBySlug(
    blogId: string,
    slug: string,
    includeRelated: boolean,
  ): Promise<{
    article: ArticleWithRelations;
    related: ArticleWithRelations[] | undefined;
  }> {
    await getBlogOr404(this.prisma, blogId);
    const article = await this.prisma.article.findFirst({
      where: { blogId, slug, status: 'PUBLISHED' },
      include: ARTICLE_INCLUDE,
    });
    if (!article) {
      throw new DomainError(
        'article.not_found',
        `No published article with slug "${slug}" in blog ${blogId}`,
      );
    }
    if (!includeRelated) {
      return { article, related: undefined };
    }
    // Public expansion: PUBLISHED related articles only, original
    // curated order, ids that no longer resolve are skipped silently.
    const related = await this.resolveRelated(blogId, article, 'PUBLISHED');
    return { article, related };
  }

  /**
   * Management related-resolution: full articles in curated order,
   * missing ids skipped silently. Unlike the public expansion this is
   * not status-filtered — editors see what the curation points at.
   */
  public async getRelated(
    blogId: string,
    orgId: string,
    articleId: string,
  ): Promise<ArticleWithRelations[]> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    const article = await this.mustExist(blogId, articleId);
    return this.resolveRelated(blogId, article, undefined);
  }

  public async update(
    blogId: string,
    orgId: string,
    articleId: string,
    input: UpdateArticleInput,
  ): Promise<ArticleWithRelations> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    const current = await this.mustExist(blogId, articleId);

    if (input.authorId !== undefined && input.authorId !== current.authorId) {
      await this.assertAuthorInBlog(blogId, input.authorId);
    }
    if (
      input.categoryId !== undefined &&
      input.categoryId !== current.categoryId
    ) {
      await this.assertCategoryInBlog(blogId, input.categoryId);
    }
    const tagIds =
      input.tagIds === undefined
        ? undefined
        : await this.assertTagsInBlog(blogId, input.tagIds);
    const relatedIds =
      input.relatedArticleIds === undefined
        ? undefined
        : await this.validateRelated(
            blogId,
            input.relatedArticleIds,
            articleId,
          );

    const slug = await resolveUpdateSlug({
      provided: input.slug,
      current: current.slug,
      isTaken: (s) => this.slugTaken(blogId, s, articleId),
      conflictCode: 'article.conflict',
    });
    const { status, publishedAt } = resolveStatusTransition(
      current.status,
      input.status,
      current.publishedAt,
      new Date(),
    );

    try {
      return await this.prisma.article.update({
        where: { id: articleId },
        data: {
          title: input.title,
          slug,
          excerpt: input.excerpt,
          content:
            input.content === undefined
              ? undefined
              : (input.content as Prisma.InputJsonValue),
          coverImageUrl: input.coverImageUrl,
          authorId: input.authorId,
          categoryId: input.categoryId,
          status,
          publishedAt,
          relatedArticleIds: relatedIds,
          ...(tagIds === undefined
            ? {}
            : { tags: { set: tagIds.map((id) => ({ id })) } }),
        },
        include: ARTICLE_INCLUDE,
      });
    } catch (error) {
      rethrowMapped(error, 'article');
    }
  }

  public async remove(
    blogId: string,
    orgId: string,
    articleId: string,
  ): Promise<void> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    await this.mustExist(blogId, articleId);
    await this.prisma.article.delete({ where: { id: articleId } });
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private async list(
    blogId: string,
    filters: ArticleListFilters,
    page: Page,
  ): Promise<{ data: ArticleWithRelations[]; total: number }> {
    const where: Prisma.ArticleWhereInput = {
      blogId,
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.authorId === undefined ? {} : { authorId: filters.authorId }),
      ...(filters.categoryId === undefined
        ? {}
        : { categoryId: filters.categoryId }),
      ...(filters.tagId === undefined
        ? {}
        : { tags: { some: { id: filters.tagId } } }),
      ...(filters.q === undefined
        ? {}
        : {
            OR: [
              { title: { contains: filters.q, mode: 'insensitive' } },
              { excerpt: { contains: filters.q, mode: 'insensitive' } },
            ],
          }),
    };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        include: ARTICLE_INCLUDE,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: page.skip,
        take: page.take,
      }),
    ]);
    return { data, total };
  }

  /**
   * Resolve `relatedArticleIds` preserving the curated order; ids that
   * no longer exist (deleted articles, dangling entries) are skipped
   * silently — curation must not 500 because one article went away.
   */
  private async resolveRelated(
    blogId: string,
    article: Pick<Article, 'relatedArticleIds'>,
    status: ArticleStatus | undefined,
  ): Promise<ArticleWithRelations[]> {
    const ids = article.relatedArticleIds;
    if (ids.length === 0) {
      return [];
    }
    const found = await this.prisma.article.findMany({
      where: {
        blogId,
        id: { in: ids },
        ...(status === undefined ? {} : { status }),
      },
      include: ARTICLE_INCLUDE,
    });
    const byId = new Map(found.map((a) => [a.id, a]));
    return ids
      .map((id) => byId.get(id))
      .filter((a): a is ArticleWithRelations => a !== undefined);
  }

  private async validateRelated(
    blogId: string,
    ids: readonly string[],
    selfId?: string,
  ): Promise<string[]> {
    const existing = await this.prisma.article.findMany({
      where: { blogId, id: { in: [...ids] } },
      select: { id: true },
    });
    return validateRelatedArticleIds(
      ids,
      new Set(existing.map((a) => a.id)),
      selfId,
    );
  }

  private async assertAuthorInBlog(
    blogId: string,
    authorId: string,
  ): Promise<void> {
    const author = await this.prisma.author.findFirst({
      where: { id: authorId, blogId },
      select: { id: true },
    });
    if (!author) {
      throw new DomainError(
        'author.not_found',
        `Author ${authorId} does not exist in blog ${blogId}`,
      );
    }
  }

  private async assertCategoryInBlog(
    blogId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, blogId },
      select: { id: true },
    });
    if (!category) {
      throw new DomainError(
        'category.not_found',
        `Category ${categoryId} does not exist in blog ${blogId}`,
      );
    }
  }

  /** Replace-set semantics: returns the validated tag ids. */
  private async assertTagsInBlog(
    blogId: string,
    tagIds: readonly string[],
  ): Promise<string[]> {
    const unique = [...new Set(tagIds)];
    const found = await this.prisma.tag.findMany({
      where: { blogId, id: { in: unique } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const foundSet = new Set(found.map((t) => t.id));
      throw new DomainError(
        'tag.not_found',
        'One or more tags do not exist in this blog',
        { missing: unique.filter((id) => !foundSet.has(id)) },
      );
    }
    return unique;
  }

  private async slugTaken(
    blogId: string,
    slug: string,
    exceptArticleId?: string,
  ): Promise<boolean> {
    const hit = await this.prisma.article.findFirst({
      where: { blogId, slug },
      select: { id: true },
    });
    return hit !== null && hit.id !== exceptArticleId;
  }

  private async mustExist(
    blogId: string,
    articleId: string,
  ): Promise<ArticleWithRelations> {
    const article = isUuid(articleId)
      ? await this.prisma.article.findFirst({
          where: { id: articleId, blogId },
          include: ARTICLE_INCLUDE,
        })
      : null;
    if (!article) {
      throw new DomainError(
        'article.not_found',
        `Article ${articleId} does not exist in blog ${blogId}`,
      );
    }
    return article;
  }
}
