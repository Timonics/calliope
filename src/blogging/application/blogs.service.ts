import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Blog } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess } from './blog-access';
import { rethrowMapped } from './prisma-errors';
import { resolveCreateSlug } from '../domain/slug';

export interface CreateBlogInput {
  name: string;
  slug?: string;
}

export interface Page {
  skip: number;
  take: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class BlogsService {
  public constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a blog in the caller's organization. The slug auto-generates
   * from the name (suffixing on collision) when omitted; an explicit
   * slug that collides is a `blog.conflict` — auto-suffixing only ever
   * applies to calliope-generated slugs.
   */
  public async create(orgId: string, input: CreateBlogInput): Promise<Blog> {
    const slugTaken = async (slug: string): Promise<boolean> =>
      (await this.prisma.blog.findUnique({
        where: { tenantId_slug: { tenantId: orgId, slug } },
        select: { id: true },
      })) !== null;

    const slug = await resolveCreateSlug({
      provided: input.slug,
      source: input.name,
      fallback: 'blog',
      isTaken: slugTaken,
      conflictCode: 'blog.conflict',
    });

    try {
      return await this.prisma.blog.create({
        data: { id: randomUUID(), tenantId: orgId, name: input.name, slug },
      });
    } catch (error) {
      rethrowMapped(error, 'blog');
    }
  }

  public async list(
    orgId: string,
    page: Page,
  ): Promise<{
    data: Blog[];
    meta: { total: number; page: number; pageSize: number };
  }> {
    const where = { tenantId: orgId };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.blog.count({ where }),
      this.prisma.blog.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: page.skip,
        take: page.take,
      }),
    ]);
    return { data, meta: { total, page: page.page, pageSize: page.pageSize } };
  }

  public async get(blogId: string, orgId: string): Promise<Blog> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    // assertBlogAccess loaded the row scoped to tenancy; re-fetch full.
    const blog = await this.prisma.blog.findUnique({ where: { id: blogId } });
    if (!blog) {
      // Unreachable (assertBlogAccess already 404'd), keeps return type honest.
      throw new DomainError('blog.not_found', `Blog ${blogId} does not exist`);
    }
    return blog;
  }
}
