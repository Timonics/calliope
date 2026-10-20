import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Author, Prisma } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { isUuid } from './id.util';
import { rethrowMapped } from './prisma-errors';
import type { Page } from './pagination';

export interface CreateAuthorInput {
  name: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

/** PATCH semantics: `null` clears the column, absent keeps it. */
export type UpdateAuthorInput = Partial<CreateAuthorInput>;

/**
 * Public author list projection — a small whitelist (no `blogId`, no
 * housekeeping timestamps). Raw rows are management-only.
 */
const PUBLIC_AUTHOR_SELECT = {
  id: true,
  name: true,
  bio: true,
  avatarUrl: true,
} satisfies Prisma.AuthorSelect;

export type PublicAuthorListItem = Prisma.AuthorGetPayload<{
  select: typeof PUBLIC_AUTHOR_SELECT;
}>;

@Injectable()
export class AuthorsService {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(
    blogId: string,
    orgId: string,
    input: CreateAuthorInput,
  ): Promise<Author> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    // Authors have no slug — the display name is the only handle.
    try {
      return await this.prisma.author.create({
        data: { id: randomUUID(), blogId, ...input },
      });
    } catch (error) {
      rethrowMapped(error, 'author');
    }
  }

  /**
   * Shared by the public and management list endpoints. When `orgId`
   * is given (a Bearer token was presented) the tenancy check runs — a
   * wrong-org caller gets `blog.forbidden`; anonymous callers get
   * existence-only `blog.not_found`.
   *
   * Both audiences get the `{data, total}` envelope; the public side
   * serves the whitelist projection above, management the full rows.
   */
  public async list(
    blogId: string,
    orgId: string | undefined,
    page: Page,
  ): Promise<{ data: Author[] | PublicAuthorListItem[]; total: number }> {
    if (orgId === undefined) {
      await getBlogOr404(this.prisma, blogId);
    } else {
      await assertBlogAccess(this.prisma, blogId, orgId);
    }
    const where = { blogId };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.author.count({ where }),
      orgId === undefined
        ? this.prisma.author.findMany({
            where,
            select: PUBLIC_AUTHOR_SELECT,
            orderBy: { createdAt: 'asc' },
            skip: page.skip,
            take: page.take,
          })
        : this.prisma.author.findMany({
            where,
            orderBy: { createdAt: 'asc' },
            skip: page.skip,
            take: page.take,
          }),
    ]);
    return { data, total };
  }

  public async update(
    blogId: string,
    orgId: string,
    authorId: string,
    input: UpdateAuthorInput,
  ): Promise<Author> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    await this.mustExist(blogId, authorId);
    try {
      // Tenant-scoped write (defense in depth on top of mustExist).
      const result = await this.prisma.author.updateMany({
        where: { id: authorId, blogId },
        data: input,
      });
      if (result.count === 0) {
        throw new DomainError(
          'author.not_found',
          `Author ${authorId} does not exist in blog ${blogId}`,
        );
      }
      return this.mustExist(blogId, authorId);
    } catch (error) {
      rethrowMapped(error, 'author');
    }
  }

  public async remove(
    blogId: string,
    orgId: string,
    authorId: string,
  ): Promise<void> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    await this.mustExist(blogId, authorId);
    const articleCount = await this.prisma.article.count({
      where: { authorId },
    });
    if (articleCount > 0) {
      throw new DomainError(
        'author.conflict',
        `Author ${authorId} has ${articleCount} article(s) and cannot be deleted`,
        { articleCount },
      );
    }
    try {
      const result = await this.prisma.author.deleteMany({
        where: { id: authorId, blogId },
      });
      if (result.count === 0) {
        throw new DomainError(
          'author.not_found',
          `Author ${authorId} does not exist in blog ${blogId}`,
        );
      }
    } catch (error) {
      rethrowMapped(error, 'author');
    }
  }

  /** Same-blog existence check — blog-scoped lookups NEVER use a bare id. */
  private async mustExist(blogId: string, authorId: string): Promise<Author> {
    const author = isUuid(authorId)
      ? await this.prisma.author.findFirst({
          where: { id: authorId, blogId },
        })
      : null;
    if (!author) {
      throw new DomainError(
        'author.not_found',
        `Author ${authorId} does not exist in blog ${blogId}`,
      );
    }
    return author;
  }
}
