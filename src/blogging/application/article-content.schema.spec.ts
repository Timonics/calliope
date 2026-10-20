import { articleContentSchema } from './article-content.schema';

describe('articleContentSchema', () => {
  it('accepts a block list with arbitrary block types', () => {
    const result = articleContentSchema.safeParse([
      { type: 'paragraph', data: { text: 'Hello' } },
      { type: 'custom-editor-block', data: { anything: [1, 2, 3] } },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects an empty content array', () => {
    expect(articleContentSchema.safeParse([]).success).toBe(false);
  });

  it('rejects non-array content', () => {
    expect(articleContentSchema.safeParse({}).success).toBe(false);
    expect(articleContentSchema.safeParse('text').success).toBe(false);
  });

  it('rejects blocks with a missing/empty type', () => {
    expect(articleContentSchema.safeParse([{ data: {} }]).success).toBe(false);
    expect(
      articleContentSchema.safeParse([{ type: '', data: {} }]).success,
    ).toBe(false);
  });

  it('rejects blocks whose data is not an object', () => {
    expect(
      articleContentSchema.safeParse([{ type: 'paragraph', data: 'nope' }])
        .success,
    ).toBe(false);
  });

  it('rejects more than 200 blocks', () => {
    const blocks = Array.from({ length: 201 }, () => ({
      type: 'paragraph',
      data: {},
    }));
    expect(articleContentSchema.safeParse(blocks).success).toBe(false);
    expect(articleContentSchema.safeParse(blocks.slice(0, 200)).success).toBe(
      true,
    );
  });

  it('rejects blocks with more than 100 data keys', () => {
    const manyKeys = Object.fromEntries(
      Array.from({ length: 101 }, (_, i) => [`k${i}`, 1]),
    );
    expect(
      articleContentSchema.safeParse([{ type: 'paragraph', data: manyKeys }])
        .success,
    ).toBe(false);
    expect(
      articleContentSchema.safeParse([
        { type: 'paragraph', data: { a: 1, b: 2 } },
      ]).success,
    ).toBe(true);
  });
});
