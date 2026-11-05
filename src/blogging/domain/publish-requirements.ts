import { DomainError } from '../../shared/kernel/domain-error';

/**
 * Publish gate — the extended article contract makes `excerpt` and a
 * fully-described `coverImage` REQUIRED the moment an article becomes
 * PUBLISHED (drafts may carry either, both, or neither). Pure function so
 * the rule is unit-testable without a database; the service layer calls
 * it with the EFFECTIVE values (current row merged with the incoming
 * patch) whenever the resolved status is PUBLISHED — on create and on
 * update, so a draft can never slip past the gate via PATCH either.
 *
 * Failure is `article.publish.incomplete` (422 — the request is
 * well-formed but cannot be acted on while the article is missing
 * contract-required fields; see DomainErrorFilter's exact-match table).
 * `missing` lists the absent requirements so clients can branch without
 * parsing the message.
 */
export interface PublishRequirementsInput {
  excerpt: string | null;
  coverImage: unknown;
}

type RequiredKey = 'excerpt' | 'coverImage';

export function assertPublishable(input: PublishRequirementsInput): void {
  const missing: RequiredKey[] = [];

  if (input.excerpt === null || input.excerpt.trim() === '') {
    missing.push('excerpt');
  }
  if (coverImageProblems(input.coverImage).length > 0) {
    missing.push('coverImage');
  }

  if (missing.length > 0) {
    throw new DomainError(
      'article.publish.incomplete',
      `Cannot publish: article is missing required field(s): ${missing.join(
        ', ',
      )}`,
      { missing },
    );
  }
}

/**
 * Structural check of the stored coverImage JSON. Returns the list of
 * problems (empty = publishable). The DTO layer validates the write
 * shape already; this re-checks at the gate so rows written through any
 * path (seed, backfill, older clients setting only `coverImageUrl`)
 * cannot publish without alt/width/height.
 */
export function coverImageProblems(coverImage: unknown): string[] {
  if (typeof coverImage !== 'object' || coverImage === null) {
    return ['coverImage is missing'];
  }
  const image = coverImage as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof image.url !== 'string' || image.url === '') {
    problems.push('coverImage.url is required');
  }
  if (typeof image.alt !== 'string' || image.alt.trim() === '') {
    problems.push('coverImage.alt is required');
  }
  if (!isPositiveInt(image.width)) {
    problems.push('coverImage.width must be a positive integer');
  }
  if (!isPositiveInt(image.height)) {
    problems.push('coverImage.height must be a positive integer');
  }
  return problems;
}

function isPositiveInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
