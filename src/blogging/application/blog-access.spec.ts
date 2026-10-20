import type { Blog } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { assertBlogAccess, getBlogOr404 } from './blog-access';
import type { BlogLookup } from './blog-access';

/**
 * The tenancy choke point, unit-tested against the `BlogLookup` port —
 * a plain `{ blog: { findUnique } }` mock, no database. Contract under
 * test:
 *
 *   * `assertBlogAccess` — malformed id → 404 WITHOUT hitting the port;
 *     unknown id → 404; another tenant's blog → 403 (authenticated
 *     callers get the honest signal); own blog → returned.
 *   * `getBlogOr404` — existence only: it must NOT compare tenants, so
 *     a foreign blog still resolves (public routes key on the blog
 *     UUID alone).
 */

const BLOG_ID = '123e4567-e89b-42d3-a456-426614174000';
const ORG_A = '123e4567-e89b-42d3-a456-426614174001';
const ORG_B = '123e4567-e89b-42d3-a456-426614174002';

const blogRow = (tenantId: string): Blog => ({
  id: BLOG_ID,
  tenantId,
  name: 'Engineering',
  slug: 'engineering',
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeLookup = (
  blog: Blog | null,
): BlogLookup & {
  findUnique: jest.Mock;
} => {
  const findUnique = jest.fn().mockResolvedValue(blog);
  return { blog: { findUnique }, findUnique };
};

describe('assertBlogAccess', () => {
  it('404s a non-UUID id without touching the lookup port', async () => {
    const lookup = makeLookup(blogRow(ORG_A));
    await expect(
      assertBlogAccess(lookup, 'not-a-uuid', ORG_A),
    ).rejects.toMatchObject({ code: 'blog.not_found' });
    expect(lookup.findUnique).not.toHaveBeenCalled();
  });

  it('404s an unknown blog', async () => {
    await expect(
      assertBlogAccess(makeLookup(null), BLOG_ID, ORG_A),
    ).rejects.toMatchObject({ code: 'blog.not_found' });
  });

  it('403s a blog owned by another tenant', async () => {
    await expect(
      assertBlogAccess(makeLookup(blogRow(ORG_B)), BLOG_ID, ORG_A),
    ).rejects.toMatchObject({
      code: 'blog.forbidden',
      clientMeta: { blogId: BLOG_ID },
    });
  });

  it('returns the full blog row for the owning tenant', async () => {
    const blog = blogRow(ORG_A);
    await expect(
      assertBlogAccess(makeLookup(blog), BLOG_ID, ORG_A),
    ).resolves.toBe(blog);
  });

  it('rejects with a DomainError instance', async () => {
    await expect(
      assertBlogAccess(makeLookup(null), BLOG_ID, ORG_A),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('getBlogOr404', () => {
  it('404s a non-UUID id without touching the lookup port', async () => {
    const lookup = makeLookup(blogRow(ORG_A));
    await expect(getBlogOr404(lookup, 'nope')).rejects.toMatchObject({
      code: 'blog.not_found',
    });
    expect(lookup.findUnique).not.toHaveBeenCalled();
  });

  it('404s an unknown blog', async () => {
    await expect(getBlogOr404(makeLookup(null), BLOG_ID)).rejects.toMatchObject(
      {
        code: 'blog.not_found',
      },
    );
  });

  it('does NOT check tenancy — a foreign blog still resolves (public route)', async () => {
    const blog = blogRow(ORG_B);
    await expect(getBlogOr404(makeLookup(blog), BLOG_ID)).resolves.toBe(blog);
  });
});
