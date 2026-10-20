import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, Tag } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { isUuid } from './id.util';
import { rethrowMapped } from './prisma-errors';
import { resolveCreateSlug, resolveUpdateSlug } from '../domain/slug';
import type { Page } from './pagination';

export interface CreateTagInput {
  name: string;
  slug?: string;
}

export type UpdateTagInput = Partial<CreateTagInput>;

/**
 * Public tag list projection — a small whitelist (id, name, slug; no
 * `blogId`, no timestamps). Raw rows are management-only.
 */
const PUBLIC_TAG_SELECT = {
  id: true,
  name: true,
  slug: true,
} satisfies Prisma.TagSelect;

export type PublicTagListItem = Prisma.TagGetPayload<{
  select: typeof PUBLIC_TAG_SELECT;
}>;

@Injectable()
export class TagsService {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(
    blogId: string,
    orgId: string,
    input: CreateTagInput,
  ): Promise<Tag> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    const slug = await resolveCreateSlug({
      provided: input.slug,
      source: input.name,
      fallback: 'tag',
      isTaken: (s) => this.slugTaken(blogId, s),
      conflictCode: 'tag.conflict',
    });
    try {
      return await this.prisma.tag.create({
        data: { id: randomUUID(), blogId, name: input.name, slug },
      });
    } catch (error) {
      rethrowMapped(error, 'tag');
    }
  }

  /**
   * Shared by the public and management list endpoints — see
   * `AuthorsService.list` for the orgId semantics and the
   * public/management projections.
   */
  public async list(
    blogId: string,
    orgId: string | undefined,
    page: Page,
  ): Promise<{ data: Tag[] | PublicTagListItem[]; total: number }> {
    if (orgId === undefined) {
      await getBlogOr404(this.prisma, blogId);
    } else {
      await assertBlogAccess(this.prisma, blogId, orgId);
    }
    const where = { blogId };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.tag.count({ where }),
      orgId === undefined
        ? this.prisma.tag.findMany({
            where,
            select: PUBLIC_TAG_SELECT,
            orderBy: { createdAt: 'asc' },
            skip: page.skip,
            take: page.take,
          })
        : this.prisma.tag.findMany({
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
    tagId: string,
    input: UpdateTagInput,
  ): Promise<Tag> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    const current = await this.mustExist(blogId, tagId);
    const slug = await resolveUpdateSlug({
      provided: input.slug,
      current: current.slug,
      isTaken: (s) => this.slugTaken(blogId, s),
      conflictCode: 'tag.conflict',
    });
    try {
      // Tenant-scoped write (defense in depth on top of mustExist).
      const result = await this.prisma.tag.updateMany({
        where: { id: tagId, blogId },
        data: { name: input.name, slug },
      });
      if (result.count === 0) {
        throw new DomainError(
          'tag.not_found',
          `Tag ${tagId} does not exist in blog ${blogId}`,
        );
      }
      return this.mustExist(blogId, tagId);
    } catch (error) {
      rethrowMapped(error, 'tag');
    }
  }

  public async remove(
    blogId: string,
    orgId: string,
    tagId: string,
  ): Promise<void> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    await this.mustExist(blogId, tagId);
    try {
      // The implicit _ArticleToTag rows cascade; the try/rethrowMapped
      // keeps any FK surprise on the friendly {code, message} path.
      const result = await this.prisma.tag.deleteMany({
        where: { id: tagId, blogId },
      });
      if (result.count === 0) {
        throw new DomainError(
          'tag.not_found',
          `Tag ${tagId} does not exist in blog ${blogId}`,
        );
      }
    } catch (error) {
      rethrowMapped(error, 'tag');
    }
  }

  private async slugTaken(blogId: string, slug: string): Promise<boolean> {
    return (
      (await this.prisma.tag.findUnique({
        where: { blogId_slug: { blogId, slug } },
        select: { id: true },
      })) !== null
    );
  }

  private async mustExist(blogId: string, tagId: string): Promise<Tag> {
    const tag = isUuid(tagId)
      ? await this.prisma.tag.findFirst({
          where: { id: tagId, blogId },
        })
      : null;
    if (!tag) {
      throw new DomainError(
        'tag.not_found',
        `Tag ${tagId} does not exist in blog ${blogId}`,
      );
    }
    return tag;
  }
}
