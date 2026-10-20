/**
 * Slug utilities — the ONLY place slug text transformations live.
 *
 * Conventions:
 *
 *   * `slugify` — lowercase, whitespace runs → `-`, strip everything
 *     that is not `[a-z0-9-]`, collapse repeated `-`. Returns
 *     `fallback` when nothing survives (e.g. a CJK-only name) so we
 *     never persist an empty slug.
 *   * `ensureUniqueSlug` — numeric-suffix loop used ONLY when calliope
 *     generates the slug itself. Callers that accepted an explicit
 *     slug from the client must NOT suffix: a collision there is a
 *     `*.conflict` (409), surfaced by the service layer.
 */
import { DomainError, DomainErrorCode } from '../../shared/kernel/domain-error';

export function slugify(input: string, fallback = 'untitled'): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug === '' ? fallback : slug;
}

/**
 * Return `base` if free, otherwise `base-2`, `base-3`, … — first free
 * candidate wins. The DB unique constraint remains the backstop for
 * races between the check and the insert.
 */
export async function ensureUniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) {
    return base;
  }
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }
}

/**
 * Slug policy for CREATE endpoints, shared by every blog-scoped
 * resource (blogs, categories, tags; articles build on it in the
 * articles service):
 *
 *   * slug omitted (or empty after normalization) → generate from
 *     `source` (title/name) and suffix until free — this is the ONLY
 *     path that auto-suffixes;
 *   * explicit slug → normalize; collision → `*.conflict` (client
 *     asked for something taken, that is a 409, not a surprise
 *     rename).
 */
export async function resolveCreateSlug(options: {
  provided: string | undefined;
  source: string;
  fallback: string;
  isTaken: (slug: string) => Promise<boolean>;
  conflictCode: DomainErrorCode;
}): Promise<string> {
  const normalized =
    options.provided === undefined ? '' : slugify(options.provided, '');
  if (normalized === '') {
    return ensureUniqueSlug(
      slugify(options.source, options.fallback),
      options.isTaken,
    );
  }
  if (await options.isTaken(normalized)) {
    throw new DomainError(
      options.conflictCode,
      `Slug "${normalized}" is already in use`,
      { slug: normalized },
    );
  }
  return normalized;
}

/**
 * Slug policy for PATCH endpoints: an explicit slug changes the slug
 * only when it differs from the current one and is free; a collision
 * → `*.conflict`. When the field is absent the current slug is kept
 * (never re-derived from a renamed title — slugs are URLs, stability
 * beats cleverness).
 */
export async function resolveUpdateSlug(options: {
  provided: string | undefined;
  current: string;
  isTaken: (slug: string) => Promise<boolean>;
  conflictCode: DomainErrorCode;
}): Promise<string> {
  if (options.provided === undefined) {
    return options.current;
  }
  const normalized = slugify(options.provided, '');
  if (normalized === '' || normalized === options.current) {
    return options.current;
  }
  if (await options.isTaken(normalized)) {
    throw new DomainError(
      options.conflictCode,
      `Slug "${normalized}" is already in use`,
      { slug: normalized },
    );
  }
  return normalized;
}
