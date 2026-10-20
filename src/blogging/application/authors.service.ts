import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Author } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { isUuid } from './id.util';
import { rethrowMapped } from './prisma-errors';
import type { Page } from './blogs.service';

export interface CreateAuthorInput {
  name: string;
  bio?: string;
  avatarUrl?: string;
}

export type UpdateAuthorInput = Partial<CreateAuthorInput>;

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
   * Shared by the public and management list endpoints (identical
   * payload). When `orgId` is given (a Bearer token was presented) the
   * tenancy check runs — a wrong-org caller gets `blog.forbidden`;
   * anonymous callers get existence-only `blog.not_found`.
   */
  public async list(
    blogId: string,
    orgId?: string,
    page?: Page,
  ): Promise<Author[]> {
    if (orgId === undefined) {
      await getBlogOr404(this.prisma, blogId);
    } else {
      await assertBlogAccess(this.prisma, blogId, orgId);
    }
    return this.prisma.author.findMany({
      where: { blogId },
      orderBy: { createdAt: 'asc' },
      ...(page === undefined ? {} : { skip: page.skip, take: page.take }),
    });
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
      return await this.prisma.author.update({
        where: { id: authorId },
        data: input,
      });
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
    await this.prisma.author.delete({ where: { id: authorId } });
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
