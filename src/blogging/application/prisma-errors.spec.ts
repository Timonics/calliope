import { Prisma } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';
import { rethrowMapped } from './prisma-errors';

/**
 * Unit coverage for the central Prisma → DomainError mapping. The
 * driver errors are constructed directly (no DB) — every service relies
 * on this function to keep Prisma types and driver strings off the wire.
 */

const knownError = (
  code: string,
  meta?: Record<string, unknown>,
): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError('driver message', {
    code,
    clientVersion: '6.0.0',
    meta,
  });

/** Capture what rethrowMapped throws (it never returns). */
const mapped = (error: unknown, resource: string): unknown => {
  try {
    rethrowMapped(error, resource);
  } catch (thrown) {
    return thrown;
  }
  throw new Error('rethrowMapped returned without throwing');
};

describe('rethrowMapped', () => {
  it('maps P2002 to <resource>.conflict with a sanitized fields list', () => {
    const error = knownError('P2002', { target: ['blogId', 'slug'] });
    const thrown = mapped(error, 'article');
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      code: 'article.conflict',
      clientMeta: { fields: ['blogId', 'slug'] },
    });
  });

  it('never leaks the raw driver meta.target into the rendered body', () => {
    const thrown = mapped(
      knownError('P2002', { target: ['tenantId', 'slug'] }),
      'blog',
    ) as DomainError;
    expect(thrown.toJSON()).toEqual({
      code: 'blog.conflict',
      message: 'A blog with this unique value already exists',
      meta: { fields: ['tenantId', 'slug'] },
    });
    expect(JSON.stringify(thrown.toJSON())).not.toContain('target');
  });

  it('omits meta when the driver target is not a string array', () => {
    const thrown = mapped(
      knownError('P2002', { target: 'some_constraint_name' }),
      'tag',
    ) as DomainError;
    expect(thrown.toJSON()).toEqual({
      code: 'tag.conflict',
      message: 'A tag with this unique value already exists',
    });
  });

  it('maps P2003 to <resource>.conflict with fields', () => {
    const thrown = mapped(
      knownError('P2003', { target: ['categoryId'] }),
      'category',
    );
    expect(thrown).toMatchObject({
      code: 'category.conflict',
      clientMeta: { fields: ['categoryId'] },
    });
  });

  it('maps P2025 to <resource>.not_found', () => {
    const thrown = mapped(knownError('P2025'), 'article');
    expect(thrown).toMatchObject({ code: 'article.not_found' });
  });

  it('rethrows an unmapped known-request error (P2023) untouched', () => {
    const error = knownError('P2023', { cause: 'malformed uuid' });
    const thrown = mapped(error, 'article');
    expect(thrown).toBe(error); // same instance, not wrapped
  });

  it('rethrows non-Prisma errors untouched', () => {
    const error = new Error('connection lost');
    const thrown = mapped(error, 'blog');
    expect(thrown).toBe(error);
  });

  it('rethrows plain objects untouched', () => {
    const error = { weird: true };
    const thrown = mapped(error, 'blog');
    expect(thrown).toBe(error);
  });
});
