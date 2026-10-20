import { Prisma } from '@prisma/client';
import { DomainError, DomainErrorCode } from '../../shared/kernel/domain-error';

/**
 * Central Prisma error mapping. Every service wraps its write in
 * `rethrowMapped` so the persistence layer never leaks Prisma types or
 * driver strings onto the wire:
 *
 *   * P2002 (unique constraint) → `<resource>.conflict` (409) — the
 *     backstop for races the service-level pre-check cannot win.
 *   * P2025 (record not found)  → `<resource>.not_found` (404).
 *   * anything else rethrows untouched (→ 500 internal.error).
 */
export function rethrowMapped(error: unknown, resource: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      throw new DomainError(
        `${resource}.conflict` as DomainErrorCode,
        `A ${resource} with this unique value already exists`,
        { target: error.meta },
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
