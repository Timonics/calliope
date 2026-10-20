import {
  ensureUniqueSlug,
  resolveCreateSlug,
  resolveUpdateSlug,
  slugify,
} from './slug';

describe('slugify', () => {
  it('normalizes titles to url-safe slugs', () => {
    expect(slugify('Hello World! 2024')).toBe('hello-world-2024');
    expect(slugify('  Multiple   Spaces ')).toBe('multiple-spaces');
    expect(slugify('a—b—c')).toBe('abc');
    expect(slugify('Already-A-Slug')).toBe('already-a-slug');
  });

  it('returns the fallback when nothing survives normalization', () => {
    expect(slugify('日本語')).toBe('untitled');
    expect(slugify('!!!', 'post')).toBe('post');
  });
});

describe('ensureUniqueSlug', () => {
  it('returns the base slug when free', async () => {
    await expect(
      ensureUniqueSlug('hello', () => Promise.resolve(false)),
    ).resolves.toBe('hello');
  });

  it('appends numeric suffixes until free', async () => {
    const taken = new Set(['hello', 'hello-2']);
    await expect(
      ensureUniqueSlug('hello', (s) => Promise.resolve(taken.has(s))),
    ).resolves.toBe('hello-3');
  });
});

describe('resolveCreateSlug', () => {
  const isTaken = () => Promise.resolve(false);

  it('generates and suffixes when no slug is provided', async () => {
    const taken = new Set(['my-post']);
    await expect(
      resolveCreateSlug({
        provided: undefined,
        source: 'My Post',
        fallback: 'post',
        isTaken: (s) => Promise.resolve(taken.has(s)),
        conflictCode: 'article.conflict',
      }),
    ).resolves.toBe('my-post-2');
  });

  it('accepts and normalizes a provided slug when free', async () => {
    await expect(
      resolveCreateSlug({
        provided: 'My Post!',
        source: 'ignored',
        fallback: 'post',
        isTaken,
        conflictCode: 'article.conflict',
      }),
    ).resolves.toBe('my-post');
  });

  it('throws *.conflict when a provided slug is taken', async () => {
    await expect(
      resolveCreateSlug({
        provided: 'taken',
        source: 'x',
        fallback: 'post',
        isTaken: () => Promise.resolve(true),
        conflictCode: 'category.conflict',
      }),
    ).rejects.toMatchObject({ code: 'category.conflict' });
  });
});

describe('resolveUpdateSlug', () => {
  it('keeps the current slug when the field is absent', async () => {
    await expect(
      resolveUpdateSlug({
        provided: undefined,
        current: 'old-slug',
        isTaken: () => Promise.resolve(false),
        conflictCode: 'tag.conflict',
      }),
    ).resolves.toBe('old-slug');
  });

  it('keeps the current slug when unchanged or normalizing to it', async () => {
    await expect(
      resolveUpdateSlug({
        provided: 'old-slug',
        current: 'old-slug',
        isTaken: () => Promise.resolve(false),
        conflictCode: 'tag.conflict',
      }),
    ).resolves.toBe('old-slug');
  });

  it('throws *.conflict on a taken rename', async () => {
    await expect(
      resolveUpdateSlug({
        provided: 'new-slug',
        current: 'old-slug',
        isTaken: () => Promise.resolve(true),
        conflictCode: 'tag.conflict',
      }),
    ).rejects.toMatchObject({ code: 'tag.conflict' });
  });
});
