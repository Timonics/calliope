import {
  MAX_RELATED_ARTICLES,
  validateRelatedArticleIds,
} from './related-articles';

const inBlog = new Set(['a1', 'a2', 'a3']);

/** Run `fn`, asserting it throws a DomainError-shaped article.validation. */
const expectValidationError = (fn: () => unknown): void => {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code: 'article.validation' });
    return;
  }
  throw new Error('expected article.validation to be thrown');
};

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
    expectValidationError(() =>
      validateRelatedArticleIds(['a1', 'a1'], inBlog),
    );
  });

  it('rejects more than the cap', () => {
    const ids = Array.from(
      { length: MAX_RELATED_ARTICLES + 1 },
      (_, i) => `x${i}`,
    );
    const set = new Set(ids);
    expectValidationError(() => validateRelatedArticleIds(ids, set));
  });

  it('accepts exactly the cap boundary', () => {
    const ids = Array.from({ length: MAX_RELATED_ARTICLES }, (_, i) => `x${i}`);
    const set = new Set(ids);
    expect(validateRelatedArticleIds(ids, set)).toEqual(ids);
  });

  it('rejects self-reference on update', () => {
    expectValidationError(() =>
      validateRelatedArticleIds(['a1', 'self'], inBlog, 'self'),
    );
  });

  it('rejects ids that are not articles of the same blog', () => {
    expectValidationError(() =>
      validateRelatedArticleIds(['a1', 'other'], inBlog),
    );
  });
});
