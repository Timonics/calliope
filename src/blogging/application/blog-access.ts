import type { Blog } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { isUuid } from './id.util';

/**
 * Blog tenancy guards — the single choke point every management
 * (Bearer-authenticated) route must pass through before touching a
 * blog's resources.
 *
 *   * `assertBlogAccess` — management routes: the blog must exist AND
 *     belong to the caller's organization. Unknown id →
 *     `blog.not_found` (404); another tenant's blog → `blog.forbidden`
 *     (403). The 403-not-404 choice on cross-tenant ids is deliberate:
 *     the caller IS authenticated, so telling them "this exists but is
 *     not yours" leaks nothing to the unauthenticated. Returns the full
 *     blog row so callers (e.g. `BlogsService.get`) don't re-fetch.
 *   * `getBlogOr404` — public routes: existence only, no tenant check
 *     (the blog UUID is the public identifier).
 */
export interface BlogLookup {
  blog: {
    findUnique(args: { where: { id: string } }): Promise<Blog | null>;
  };
}

export async function assertBlogAccess(
  prisma: BlogLookup,
  blogId: string,
  orgId: string,
): Promise<Blog> {
  if (!isUuid(blogId)) {
    throw new DomainError('blog.not_found', `Blog ${blogId} does not exist`);
  }
  const blog = await prisma.blog.findUnique({ where: { id: blogId } });
  if (!blog) {
    throw new DomainError('blog.not_found', `Blog ${blogId} does not exist`);
  }
  if (blog.tenantId !== orgId) {
    throw new DomainError(
      'blog.forbidden',
      `Blog ${blogId} does not belong to this organization`,
      { blogId },
    );
  }
  return blog;
}

export async function getBlogOr404(
  prisma: BlogLookup,
  blogId: string,
): Promise<Blog> {
  if (!isUuid(blogId)) {
    throw new DomainError('blog.not_found', `Blog ${blogId} does not exist`);
  }
  const blog = await prisma.blog.findUnique({ where: { id: blogId } });
  if (!blog) {
    throw new DomainError('blog.not_found', `Blog ${blogId} does not exist`);
  }
  return blog;
}
