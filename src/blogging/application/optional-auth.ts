import type { Request } from 'express';
import {
  extractBearerToken,
  JwksPrincipalProvider,
  Principal,
} from '@timonics/auth-guard';

/**
 * `OPTIONAL_PRINCIPAL_RESOLVER` — resolves a principal for routes that
 * are `@Public()` but have a management flavour when the caller DOES
 * present a Bearer token (e.g. `GET /v1/blogs/:blogId/articles` is the
 * public published-only list without a token and the management
 * all-statuses list with one).
 *
 * Why this exists: the global `JwtAuthGuard` skips `@Public()` routes
 * unconditionally — `req.user` stays undefined even when a valid
 * token is presented. Rather than duplicating route registrations
 * (same path, ambiguous Express ordering), the shared handler asks
 * this resolver:
 *
 *   * no `Authorization` header → `undefined` (public view);
 *   * header present → verify locally against the cerberus JWKS (same
 *     provider the guard uses); invalid/expired tokens surface as the
 *     package's 401 `authorization.token.invalid`.
 *
 * The instance is registered in `BloggingModule` so integration tests
 * can stub it out; production wiring builds a `JwksPrincipalProvider`
 * from `config.ts`.
 */
export interface OptionalPrincipalResolver {
  resolve(request: Request): Promise<Principal | undefined>;
}

export const OPTIONAL_PRINCIPAL_RESOLVER = Symbol(
  'OPTIONAL_PRINCIPAL_RESOLVER',
);

export class JwksOptionalPrincipalResolver implements OptionalPrincipalResolver {
  private readonly provider: JwksPrincipalProvider;

  public constructor(
    options: ConstructorParameters<typeof JwksPrincipalProvider>[0],
  ) {
    this.provider = new JwksPrincipalProvider(options);
  }

  public async resolve(request: Request): Promise<Principal | undefined> {
    if (extractBearerToken(request) === null) {
      return undefined;
    }
    return this.provider.resolvePrincipal(request);
  }
}
