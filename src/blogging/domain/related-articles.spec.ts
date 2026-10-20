import {
  MAX_RELATED_ARTICLES,
  validateRelatedArticleIds,
} from './related-articles';

const inBlog = new Set(['a1', 'a2', 'a3']);

describe('validateRelatedArticleIds', () => {
  it('accepts an empty list', () => {
    expect(validateRelatedArticleIds([], inBlog)).toEqual([]);
  });

  it('preserves the given (curated) order', () => {
    expect(validateRelatedArticleIds(['a3', 'a1'], inBlog)).toEqual([
      'a3',
      'a1',
    ]);
  });

  it('rejects duplicates', () => {
    expect(() => validateRelatedArticleIds(['a1', 'a1'], inBlog)).toThrow(
      expect.objectContaining({ code: 'article.validation' }),
    );
  });

  it('rejects more than the cap', () => {
    const ids = Array.from(
      { length: MAX_RELATED_ARTICLES + 1 },
      (_, i) => `x${i}`,
    );
    const set = new Set(ids);
    expect(() => validateRelatedArticleIds(ids, set)).toThrow(
      expect.objectContaining({ code: 'article.validation' }),
    );
  });

  it('rejects self-reference on update', () => {
    expect(() =>
      validateRelatedArticleIds(['a1', 'self'], inBlog, 'self'),
    ).toThrow(expect.objectContaining({ code: 'article.validation' }));
  });

  it('rejects ids that are not articles of the same blog', () => {
    expect(() => validateRelatedArticleIds(['a1', 'other'], inBlog)).toThrow(
      expect.objectContaining({ code: 'article.validation' }),
    );
  });
});
