import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Article } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { isUuid } from './id.util';
import { rethrowMapped } from './prisma-errors';
import { resolveCreateSlug, resolveUpdateSlug } from '../domain/slug';
import { resolveStatusTransition } from '../domain/article-status';
import type { ArticleStatus } from '../domain/article-status';
import { validateRelatedArticleIds } from '../domain/related-articles';
import type { Page } from './pagination';

export interface CreateArticleInput {
  /**
   * Optional client-supplied UUID — the idempotency primitive (see
   * `create`).
   */
  id?: string;
  title: string;
  slug?: string;
  excerpt?: string | null;
  content: unknown; // validated upstream by articleContentSchema (DTO pipe)
  coverImageUrl?: string | null;
  authorId: string;
  categoryId?: string | null;
  tagIds?: string[];
  status?: ArticleStatus;
  relatedArticleIds?: string[];
}

export type UpdateArticleInput = Partial<CreateArticleInput> & {
  /** Optimistic-lock expectation; absent = last-write-wins. */
  version?: number;
};

export interface ArticleListFilters {
  status?: ArticleStatus;
  authorId?: string;
  categoryId?: string;
  tagId?: string;
  /**
   * Case-insensitive contains on title/excerpt. `%`, `_` and `\` are
   * escaped before the ILIKE so the term is matched literally (see
   * `escapeLikeTerm`).
   */
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

/** Management list rows carry everything except the heavy `content` JSON. */
type ArticleListItem = Prisma.ArticleGetPayload<{
  include: typeof ARTICLE_INCLUDE;
  omit: { content: true };
}>;

/** Replays are honored for this long; older keys are treated as unseen. */
const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

/** Endpoint discriminator stored with each idempotency key. */
const IDEMPOTENCY_ENDPOINT = 'articles.create';

@Injectable()
export class ArticlesService {
  public constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent create. Two client-controlled mechanisms, either works:
   *
   *   * client-supplied `id` in the body — used verbatim as the article
   *     id (upsert-on-conflict semantics: a P2002 on that id means a
   *     replay or a lost response, so the existing row is fetched and
   *     returned with 200 instead of erroring);
   *   * `Idempotency-Key` request header — stored in `idempotency_keys`
   *     (key + blog + endpoint, 24h retention) after the first create;
   *     a replay within the window returns the stored article with 200.
   *
   * Both checks and the insert run in one transaction; the unique
   * constraints are the race backstop. Returns `replayed` so the
   * controller can answer 200 (replay) vs 201 (created).
   */
  public async create(
    blogId: string,
    orgId: string,
    input: CreateArticleInput,
    idempotencyKey?: string,
  ): Promise<{ article: ArticleWithRelations; replayed: boolean }> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    await this.assertAuthorInBlog(blogId, input.authorId);
    if (input.categoryId != null) {
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
      return await this.prisma.$transaction(async (tx) => {
        if (idempotencyKey !== undefined) {
          const seen = await tx.idempotencyKey.findUnique({
            where: {
              key_blogId_endpoint: {
                key: idempotencyKey,
                blogId,
                endpoint: IDEMPOTENCY_ENDPOINT,
              },
            },
          });
          if (seen !== null) {
            if (this.isFreshKey(seen.createdAt)) {
              const existing = await tx.article.findFirst({
                where: { id: seen.articleId, blogId },
                include: ARTICLE_INCLUDE,
              });
              if (existing !== null) {
                return { article: existing, replayed: true };
              }
            }
            // Article gone (deleted) or key expired — the mapping is
            // dead weight; drop it so the insert below can re-use it.
            await tx.idempotencyKey.delete({ where: { id: seen.id } });
          }
        }
        if (input.id !== undefined) {
          const existing = await tx.article.findFirst({
            where: { id: input.id, blogId },
            include: ARTICLE_INCLUDE,
          });
          if (existing !== null) {
            return { article: existing, replayed: true };
          }
        }
        const article = await tx.article.create({
          data: {
            id: input.id ?? randomUUID(),
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
        if (idempotencyKey !== undefined) {
          await tx.idempotencyKey.create({
            data: {
              id: randomUUID(),
              key: idempotencyKey,
              blogId,
              endpoint: IDEMPOTENCY_ENDPOINT,
              articleId: article.id,
            },
          });
        }
        return { article, replayed: false };
      });
    } catch (error) {
      // Race backstop: a concurrent request with the same idempotency
      // key or client-supplied id committed between our check and our
      // insert (unique constraint fires). Fetch the winner and replay.
      if (this.replayAfterRace(idempotencyKey, input.id, error)) {
        const raced = await this.findReplayTarget(
          blogId,
          idempotencyKey,
          input.id,
        );
        if (raced !== null) {
          return { article: raced, replayed: true };
        }
      }
      rethrowMapped(error, 'article');
    }
  }

  /** Management list — every status, extra `status` filter. */
  public async listManagement(
    blogId: string,
    orgId: string,
    filters: ArticleListFilters,
    page: Page,
  ): Promise<{ data: ArticleListItem[]; total: number }> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    const { data, total } = await this.list(
      blogId,
      filters,
      page,
      'management',
    );
    return { data: data as ArticleListItem[], total };
  }

  /** Public list — published only, always. */
  public async listPublic(
    blogId: string,
    filters: ArticleListFilters,
    page: Page,
  ): Promise<{ data: ArticleWithRelations[]; total: number }> {
    await getBlogOr404(this.prisma, blogId);
    const { data, total } = await this.list(
      blogId,
      { ...filters, status: 'PUBLISHED' },
      page,
      'public',
    );
    return { data: data as ArticleWithRelations[], total };
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

  /**
   * PATCH semantics: `null` CLEARS a nullable column (`excerpt`,
   * `coverImageUrl`, `categoryId`), absent/undefined keeps the current
   * value — the DTO layer (`.nullable().optional()` + `.partial()`)
   * preserves that distinction through validation.
   *
   * Optimistic locking: when `input.version` is present the write is
   * conditional on the row still carrying that version; a mismatch is
   * 409 `article.conflict` (absent = last-write-wins, but the version
   * still increments so future optimistic writers aren't blind).
   *
   * The scalar write is tenant-scoped via `updateMany` (defense in
   * depth on top of `mustExist`); relation writes (tags) run inside the
   * same transaction against the now-verified id.
   */
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
    if (input.categoryId != null && input.categoryId !== current.categoryId) {
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
      return await this.prisma.$transaction(async (tx) => {
        const result = await tx.article.updateMany({
          where: {
            id: articleId,
            blogId,
            ...(input.version === undefined ? {} : { version: input.version }),
          },
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
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          // `mustExist` already verified id+blog, so a zero-count here
          // can only be the optimistic-lock guard firing.
          throw new DomainError(
            'article.conflict',
            `Article ${articleId} was modified concurrently (expected version ${input.version}, current version ${current.version})`,
            { expectedVersion: input.version, currentVersion: current.version },
            { articleId, blogId },
          );
        }
        if (tagIds !== undefined) {
          // updateMany cannot carry nested relation writes; the id is
          // tenant-verified by the updateMany above.
          await tx.article.update({
            where: { id: articleId },
            data: { tags: { set: tagIds.map((id) => ({ id })) } },
          });
        }
        const updated = await tx.article.findFirst({
          where: { id: articleId, blogId },
          include: ARTICLE_INCLUDE,
        });
        if (updated === null) {
          // Unreachable (updateMany matched exactly this row).
          throw new DomainError(
            'article.not_found',
            `Article ${articleId} does not exist in blog ${blogId}`,
          );
        }
        return updated;
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
    try {
      const result = await this.prisma.article.deleteMany({
        where: { id: articleId, blogId },
      });
      if (result.count === 0) {
        throw new DomainError(
          'article.not_found',
          `Article ${articleId} does not exist in blog ${blogId}`,
        );
      }
    } catch (error) {
      rethrowMapped(error, 'article');
    }
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  /**
   * Shared list core. Ordering differs by audience (documented choice):
   * the management list sorts by `createdAt desc` — `publishedAt` is
   * null for drafts, and Postgres sorts nulls FIRST in DESC order,
   * which buries freshly-created drafts under old published posts. The
   * public list keeps `publishedAt desc` (every row there is published,
   * so the field is never null).
   */
  private async list(
    blogId: string,
    filters: ArticleListFilters,
    page: Page,
    mode: 'management' | 'public',
  ): Promise<{
    data: ArticleListItem[] | ArticleWithRelations[];
    total: number;
  }> {
    if (filters.q !== undefined) {
      return this.searchList(blogId, { ...filters, q: filters.q }, page, mode);
    }
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
    };
    const orderBy: Prisma.ArticleOrderByWithRelationInput[] =
      mode === 'management'
        ? [{ createdAt: 'desc' }, { id: 'desc' }]
        : [{ publishedAt: 'desc' }, { id: 'desc' }];
    const [total, data] = await this.prisma.$transaction([
      this.prisma.article.count({ where }),
      // Management lists omit the heavy `content` JSON; the public
      // list needs it (renderers fetch the full block list).
      this.prisma.article.findMany({
        where,
        include: ARTICLE_INCLUDE,
        ...(mode === 'management' ? { omit: { content: true } } : {}),
        orderBy,
        skip: page.skip,
        take: page.take,
      }),
    ]);
    return { data, total };
  }

  /**
   * `q` search. Prisma's `contains` cannot express an ESCAPE clause, so
   * the matching-id selection (count + page, consistent inside one
   * transaction) is raw SQL with a parameterized ILIKE … ESCAPE '\';
   * `%`, `_` and `\` in the user term are backslash-escaped first so
   * they match literally. Full rows (with relations) are then loaded
   * through Prisma and re-ordered to the raw page order. Backed by the
   * pg_trgm GIN indexes on articles(title)/(excerpt) (see migrations).
   */
  private async searchList(
    blogId: string,
    filters: ArticleListFilters & { q: string },
    page: Page,
    mode: 'management' | 'public',
  ): Promise<{
    data: ArticleListItem[] | ArticleWithRelations[];
    total: number;
  }> {
    const pattern = `%${escapeLikeTerm(filters.q)}%`;
    // Explicit casts: the parameters arrive as text; the columns are
    // uuid / enum-typed.
    const where = Prisma.sql`
      "blogId" = ${blogId}::uuid
      ${filters.status === undefined ? Prisma.empty : Prisma.sql`AND "status" = ${filters.status}::"ArticleStatus"`}
      ${filters.authorId === undefined ? Prisma.empty : Prisma.sql`AND "authorId" = ${filters.authorId}::uuid`}
      ${filters.categoryId === undefined ? Prisma.empty : Prisma.sql`AND "categoryId" = ${filters.categoryId}::uuid`}
      ${filters.tagId === undefined ? Prisma.empty : Prisma.sql`AND id IN (SELECT "A" FROM "_ArticleToTag" WHERE "B" = ${filters.tagId}::uuid)`}
      AND ("title" ILIKE ${pattern} ESCAPE '\\' OR "excerpt" ILIKE ${pattern} ESCAPE '\\')
    `;
    const order =
      mode === 'management'
        ? Prisma.sql`ORDER BY "createdAt" DESC, id DESC`
        : Prisma.sql`ORDER BY "publishedAt" DESC NULLS LAST, id DESC`;
    const [countRows, idRows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ count: number }[]>(
        Prisma.sql`SELECT count(*)::int AS count FROM articles WHERE ${where}`,
      ),
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM articles WHERE ${where} ${order} OFFSET ${page.skip} LIMIT ${page.take}`,
      ),
    ]);
    const total = countRows[0]?.count ?? 0;
    const ids = idRows.map((row) => row.id);
    if (ids.length === 0) {
      return { data: [], total };
    }
    const found = await this.prisma.article.findMany({
      where: { id: { in: ids } },
      include: ARTICLE_INCLUDE,
      ...(mode === 'management' ? { omit: { content: true } } : {}),
    });
    const byId = new Map(found.map((a) => [a.id, a]));
    return { data: ids.map((id) => byId.get(id)).filter(isPresent), total };
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

  private isFreshKey(createdAt: Date): boolean {
    return createdAt.getTime() >= Date.now() - IDEMPOTENCY_KEY_TTL_MS;
  }

  /**
   * Whether a just-thrown error could be the unique-constraint race of
   * a concurrent replay (same idempotency key or client-supplied id).
   */
  private replayAfterRace(
    idempotencyKey: string | undefined,
    clientId: string | undefined,
    error: unknown,
  ): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    const fields = Array.isArray(target)
      ? target.filter((t): t is string => typeof t === 'string')
      : [];
    return (
      (idempotencyKey !== undefined &&
        fields.some((f) => f.includes('idempotency'))) ||
      (clientId !== undefined && fields.includes('id'))
    );
  }

  private async findReplayTarget(
    blogId: string,
    idempotencyKey: string | undefined,
    clientId: string | undefined,
  ): Promise<ArticleWithRelations | null> {
    let articleId = clientId;
    if (articleId === undefined && idempotencyKey !== undefined) {
      const seen = await this.prisma.idempotencyKey.findUnique({
        where: {
          key_blogId_endpoint: {
            key: idempotencyKey,
            blogId,
            endpoint: IDEMPOTENCY_ENDPOINT,
          },
        },
      });
      articleId = seen?.articleId;
    }
    if (articleId === undefined) {
      return null;
    }
    return this.prisma.article.findFirst({
      where: { id: articleId, blogId },
      include: ARTICLE_INCLUDE,
    });
  }
}

/**
 * Escape the ILIKE metacharacters (`%`, `_`) and the escape character
 * itself with backslashes so a user-typed term matches literally. The
 * SQL side declares `ESCAPE '\\'` (see searchList).
 */
function escapeLikeTerm(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}
