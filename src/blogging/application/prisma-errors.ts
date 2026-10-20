import { Prisma } from '@prisma/client';
import { DomainError, DomainErrorCode } from '../../shared/kernel/domain-error';

/**
 * Central Prisma error mapping. Every service wraps its write in
 * `rethrowMapped` so the persistence layer never leaks Prisma types or
 * driver strings onto the wire:
 *
 *   * P2002 (unique constraint) → `<resource>.conflict` (409) — the
 *     backstop for races the service-level pre-check cannot win.
 *   * P2003 (FK constraint)     → `<resource>.conflict` (409) — the row
 *     is in use by other records; the app owns the friendly message
 *     (relations otherwise configured `onDelete: Restrict`).
 *   * P2025 (record not found)  → `<resource>.not_found` (404).
 *   * anything else rethrows untouched (→ 500 internal.error).
 *
 * Client payloads are sanitized: only a derived `fields` list (never the
 * raw driver `meta`, which leaks schema internals) ships as `meta`.
 */
export function rethrowMapped(error: unknown, resource: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new DomainError(
        `${resource}.conflict` as DomainErrorCode,
        `A ${resource} with this unique value already exists`,
        conflictFields(error),
      );
    }
    if (error.code === 'P2003') {
      throw new DomainError(
        `${resource}.conflict` as DomainErrorCode,
        `The ${resource} is in use by other records and cannot be modified or deleted`,
        conflictFields(error),
      );
    }
    if (error.code === 'P2025') {
      throw new DomainError(
        `${resource}.not_found` as DomainErrorCode,
        `The ${resource} does not exist`,
      );
    }
  }
  throw error;
}

/**
 * Derive a client-safe field list from the driver meta. `meta.target` is
 * an array of column names for unique/index violations; anything else
 * (FK constraint names, missing meta) is omitted rather than leaked.
 */
function conflictFields(
  error: Prisma.PrismaClientKnownRequestError,
): { fields: string[] } | undefined {
  const target = error.meta?.target;
  if (!Array.isArray(target)) {
    return undefined;
  }
  const fields = target.filter((t): t is string => typeof t === 'string');
  return fields.length > 0 ? { fields } : undefined;
}
