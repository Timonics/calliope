import { ArticleStatus } from '@prisma/client';
import { DomainError } from '../../shared/kernel/domain-error';

/**
 * Article status state machine — pure function so the transition table
 * is unit-testable without a database.
 *
 *   DRAFT ↔ PUBLISHED → ARCHIVED
 *
 * Semantics:
 *
 *   * ARCHIVED is TERMINAL. Any transition out of ARCHIVED →
 *     `article.conflict` (409).
 *   * `publishedAt` is set on the FIRST transition into PUBLISHED and
 *     is NEVER cleared afterwards — unpublishing back to DRAFT keeps
 *     the original first-publish date (it is a fact about history, not
 *     about current visibility). Re-publishing after an un-publish
 *     therefore does not move the date.
 *   * `requested === undefined` (field absent from a PATCH) leaves
 *     status and `publishedAt` untouched.
 *   * `now` is injected by the caller so tests stay deterministic.
 */
export function resolveStatusTransition(
  current: ArticleStatus,
  requested: ArticleStatus | undefined,
  publishedAt: Date | null,
  now: Date,
): { status: ArticleStatus; publishedAt: Date | null } {
  if (requested === undefined || requested === current) {
    return { status: current, publishedAt };
  }
  if (current === 'ARCHIVED') {
    throw new DomainError(
      'article.conflict',
      `An archived article cannot transition to ${requested}`,
      { current, requested },
    );
  }
  // DRAFT→PUBLISHED, PUBLISHED→DRAFT, DRAFT→ARCHIVED, PUBLISHED→ARCHIVED
  // are all legal; only the archived terminal state is enforced above.
  return {
    status: requested,
    publishedAt:
      requested === 'PUBLISHED' && publishedAt === null ? now : publishedAt,
  };
}
