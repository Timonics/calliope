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
});
