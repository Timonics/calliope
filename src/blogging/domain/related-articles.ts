import { DomainError } from '../../shared/kernel/domain-error';

/** Hard cap on manually curated related articles per article. */
export const MAX_RELATED_ARTICLES = 10;

/**
 * Validate a client-supplied `relatedArticleIds` replacement set.
 *
 *   * every id must belong to an article in the SAME blog (the caller
 *     passes the set of ids that actually exist in the blog);
 *   * no duplicates;
 *   * at most `MAX_RELATED_ARTICLES`;
 *   * on update, the article must not relate to itself.
 *
 * Violations → `article.validation` (400). The ids are stored in the
 * given order; ordering is meaningful (editor-curated reading order).
 */
export function validateRelatedArticleIds(
  ids: readonly string[],
  existingInBlog: ReadonlySet<string>,
  selfId?: string,
): string[] {
  if (new Set(ids).size !== ids.length) {
    throw new DomainError(
      'article.validation',
      'relatedArticleIds must not contain duplicates',
      { relatedArticleIds: ids },
    );
  }
  if (ids.length > MAX_RELATED_ARTICLES) {
    throw new DomainError(
      'article.validation',
      `relatedArticleIds accepts at most ${MAX_RELATED_ARTICLES} entries`,
      { count: ids.length },
    );
  }
  if (selfId !== undefined && ids.includes(selfId)) {
    throw new DomainError(
      'article.validation',
      'An article cannot relate to itself',
      { articleId: selfId },
    );
  }
  const missing = ids.filter((id) => !existingInBlog.has(id));
  if (missing.length > 0) {
    throw new DomainError(
      'article.validation',
      'relatedArticleIds must reference articles in the same blog',
      { missing },
    );
  }
  return [...ids];
}
