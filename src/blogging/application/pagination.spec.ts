import { listEnvelope, paginationQuerySchema, toPage } from './pagination';

/**
 * Offset-pagination contract: the zod schema coerces query strings,
 * enforces the bounds (page 1..10_000, pageSize 1..100) and supplies
 * defaults; `toPage` derives the skip/take window from the PARSED
 * value, so every invalid input is rejected before toPage ever runs.
 */

describe('paginationQuerySchema', () => {
  it('applies the defaults page=1, pageSize=20', () => {
    expect(paginationQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
    });
  });

  it('coerces numeric query strings', () => {
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '10' })).toEqual({
      page: 3,
      pageSize: 10,
    });
  });

  it('accepts the upper bounds (page 10_000, pageSize 100)', () => {
    expect(
      paginationQuerySchema.parse({ page: '10000', pageSize: '100' }),
    ).toEqual({
      page: 10000,
      pageSize: 100,
    });
  });

  it('rejects out-of-range values', () => {
    expect(paginationQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: -1 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: 10001 }).success).toBe(
      false,
    );
    expect(paginationQuerySchema.safeParse({ pageSize: 0 }).success).toBe(
      false,
    );
    // 101 is NOT silently capped — the request itself is rejected.
    expect(paginationQuerySchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
  });

  it('rejects non-numeric coercion failures', () => {
    expect(paginationQuerySchema.safeParse({ page: 'abc' }).success).toBe(
      false,
    );
    expect(paginationQuerySchema.safeParse({ pageSize: '1.5' }).success).toBe(
      false,
    );
    expect(paginationQuerySchema.safeParse({ page: '' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: null }).success).toBe(false);
  });
});

describe('toPage', () => {
  it('maps the defaults to the first page window', () => {
    expect(toPage({ page: 1, pageSize: 20 })).toEqual({
      skip: 0,
      take: 20,
      page: 1,
      pageSize: 20,
    });
  });

  it('derives skip/take for a middle page', () => {
    expect(toPage({ page: 2, pageSize: 1 })).toEqual({
      skip: 1,
      take: 1,
      page: 2,
      pageSize: 1,
    });
    expect(toPage({ page: 3, pageSize: 10 })).toEqual({
      skip: 20,
      take: 10,
      page: 3,
      pageSize: 10,
    });
  });
});

describe('listEnvelope', () => {
  it('echoes the requested page and total', () => {
    expect(listEnvelope(['a'], 42, { page: 2, pageSize: 1 })).toEqual({
      data: ['a'],
      meta: { total: 42, page: 2, pageSize: 1 },
    });
  });
});
