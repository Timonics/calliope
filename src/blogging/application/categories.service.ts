import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { isUuid } from './id.util';
import { rethrowMapped } from './prisma-errors';
import { resolveCreateSlug, resolveUpdateSlug } from '../domain/slug';
import type { Page } from './blogs.service';

export interface CreateCategoryInput {
  name: string;
  slug?: string;
  description?: string;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

@Injectable()
export class CategoriesService {
  public constructor(private readonly prisma: PrismaService) {}

  public async create(
    blogId: string,
    orgId: string,
    input: CreateCategoryInput,
  ): Promise<Category> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    const slug = await resolveCreateSlug({
      provided: input.slug,
      source: input.name,
      fallback: 'category',
      isTaken: (s) => this.slugTaken(blogId, s),
      conflictCode: 'category.conflict',
    });
    try {
      return await this.prisma.category.create({
        data: {
          id: randomUUID(),
          blogId,
          name: input.name,
          slug,
          description: input.description,
        },
      });
    } catch (error) {
      rethrowMapped(error, 'category');
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
  ): Promise<Category[]> {
    if (orgId === undefined) {
      await getBlogOr404(this.prisma, blogId);
    } else {
      await assertBlogAccess(this.prisma, blogId, orgId);
    }
    return this.prisma.category.findMany({
      where: { blogId },
      orderBy: { createdAt: 'asc' },
      ...(page === undefined ? {} : { skip: page.skip, take: page.take }),
    });
  }

  public async update(
    blogId: string,
    orgId: string,
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<Category> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    const current = await this.mustExist(blogId, categoryId);
    const slug = await resolveUpdateSlug({
      provided: input.slug,
      current: current.slug,
      isTaken: (s) => this.slugTaken(blogId, s),
      conflictCode: 'category.conflict',
    });
    try {
      return await this.prisma.category.update({
        where: { id: categoryId },
        data: { name: input.name, slug, description: input.description },
      });
    } catch (error) {
      rethrowMapped(error, 'category');
    }
  }

  public async remove(
    blogId: string,
    orgId: string,
    categoryId: string,
  ): Promise<void> {
    await assertBlogAccess(this.prisma, blogId, orgId);
    await this.mustExist(blogId, categoryId);
    const articleCount = await this.prisma.article.count({
      where: { categoryId },
    });
    if (articleCount > 0) {
      throw new DomainError(
        'category.conflict',
        `Category ${categoryId} has ${articleCount} article(s) and cannot be deleted`,
        { articleCount },
      );
    }
    await this.prisma.category.delete({ where: { id: categoryId } });
  }

  private async slugTaken(blogId: string, slug: string): Promise<boolean> {
    return (
      (await this.prisma.category.findUnique({
        where: { blogId_slug: { blogId, slug } },
        select: { id: true },
      })) !== null
    );
  }

  private async mustExist(
    blogId: string,
    categoryId: string,
  ): Promise<Category> {
    const category = isUuid(categoryId)
      ? await this.prisma.category.findFirst({
          where: { id: categoryId, blogId },
        })
      : null;
    if (!category) {
      throw new DomainError(
        'category.not_found',
        `Category ${categoryId} does not exist in blog ${blogId}`,
      );
    }
    return category;
  }
}
