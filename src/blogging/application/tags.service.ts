import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Tag } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { isUuid } from './id.util';
import { rethrowMapped } from './prisma-errors';
import { resolveCreateSlug, resolveUpdateSlug } from '../domain/slug';
import type { Page } from './blogs.service';

export interface CreateTagInput {
  name: string;
  slug?: string;
}

export type UpdateTagInput = Partial<CreateTagInput>;

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
   * `AuthorsService.list` for the orgId semantics.
   */
  public async list(
    blogId: string,
    orgId?: string,
    page?: Page,
  ): Promise<Tag[]> {
    if (orgId === undefined) {
      await getBlogOr404(this.prisma, blogId);
    } else {
      await assertBlogAccess(this.prisma, blogId, orgId);
    }
    return this.prisma.tag.findMany({
      where: { blogId },
      orderBy: { createdAt: 'asc' },
      ...(page === undefined ? {} : { skip: page.skip, take: page.take }),
    });
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
      return await this.prisma.tag.update({
        where: { id: tagId },
        data: { name: input.name, slug },
      });
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
    await this.prisma.tag.delete({ where: { id: tagId } });
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
