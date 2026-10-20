import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Category, Prisma } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { PrismaService } from '../../shared/infrastructure/prisma/prisma.service';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import { isUuid } from './id.util';
import { rethrowMapped } from './prisma-errors';
import { resolveCreateSlug, resolveUpdateSlug } from '../domain/slug';
import type { Page } from './pagination';

export interface CreateCategoryInput {
  name: string;
  slug?: string;
  description?: string | null;
}

/** PATCH semantics: `null` clears the column, absent keeps it. */
export type UpdateCategoryInput = Partial<CreateCategoryInput>;

/**
 * Public category list projection — a small whitelist (id, name, slug,
 * description; no `blogId`, no timestamps). Raw rows are
 * management-only.
 */
const PUBLIC_CATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
} satisfies Prisma.CategorySelect;

export type PublicCategoryListItem = Prisma.CategoryGetPayload<{
  select: typeof PUBLIC_CATEGORY_SELECT;
}>;

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
   * `AuthorsService.list` for the orgId semantics and the
   * public/management projections.
   */
  public async list(
    blogId: string,
    orgId: string | undefined,
    page: Page,
  ): Promise<{ data: Category[] | PublicCategoryListItem[]; total: number }> {
    if (orgId === undefined) {
      await getBlogOr404(this.prisma, blogId);
    } else {
      await assertBlogAccess(this.prisma, blogId, orgId);
    }
    const where = { blogId };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.category.count({ where }),
      orgId === undefined
        ? this.prisma.category.findMany({
            where,
            select: PUBLIC_CATEGORY_SELECT,
            orderBy: { createdAt: 'asc' },
            skip: page.skip,
            take: page.take,
          })
        : this.prisma.category.findMany({
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
      // Tenant-scoped write (defense in depth on top of mustExist).
      const result = await this.prisma.category.updateMany({
        where: { id: categoryId, blogId },
        data: { name: input.name, slug, description: input.description },
      });
      if (result.count === 0) {
        throw new DomainError(
          'category.not_found',
          `Category ${categoryId} does not exist in blog ${blogId}`,
        );
      }
      return this.mustExist(blogId, categoryId);
    } catch (error) {
      rethrowMapped(error, 'category');
    }
  }

  /**
   * Delete policy: the Category→Article FK is `onDelete: Restrict`
   * (schema), so the app owns the friendly 409 — articles referencing
   * the category make the delete a `category.conflict` rather than a
   * driver error. The pre-check below keeps the message informative;
   * the FK constraint is the race backstop (P2003 → same mapping).
   */
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
    try {
      const result = await this.prisma.category.deleteMany({
        where: { id: categoryId, blogId },
      });
      if (result.count === 0) {
        throw new DomainError(
          'category.not_found',
          `Category ${categoryId} does not exist in blog ${blogId}`,
        );
      }
    } catch (error) {
      rethrowMapped(error, 'category');
    }
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
