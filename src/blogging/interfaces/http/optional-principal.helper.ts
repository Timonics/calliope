import type { Request } from 'express';
import type { Principal } from '@timonics/auth-guard';
import type { OptionalPrincipalResolver } from '../../application/optional-auth';

/**
 * Resolve the caller's principal for `@Public()` routes that have a
 * management flavour when a Bearer token IS presented.
 *
 * Two sources, in order:
 *
 *   1. `req.user` — set by the global `JwtAuthGuard` on authenticated
 *      routes (and by test harnesses that override the guard);
 *   2. the `OptionalPrincipalResolver` — verifies a presented Bearer
 *      token against the cerberus JWKS; absent header → `undefined`.
 *
 * Returns `undefined` for genuinely anonymous callers.
 */
export async function resolveOptionalPrincipal(
  request: Request,
  resolver: OptionalPrincipalResolver,
): Promise<Principal | undefined> {
  // `user` is attached by the global JwtAuthGuard (express Request has no
  // such property — Nest/passport-style augmentation is deliberately not
  // declared globally here).
  const attached = (request as Request & { user?: Principal }).user;
  if (attached !== undefined) {
    return attached;
  }
  return resolver.resolve(request);
}
