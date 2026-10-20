import { AuthGuardModule } from '@timonics/auth-guard';
import { cerberusAudience, cerberusIssuer, cerberusJwksUrl } from './config';

/**
 * The single `AuthGuardModule.forRoot()` instance for the app, built
 * once at module scope and imported by every Nest module that needs
 * the package's exports (`PrincipalProvider`, the guards).
 *
 * Importing the SAME dynamic-module object reference in more than one
 * place keeps Nest's module opaque key identical, so the package's
 * providers — including the `JwksPrincipalProvider` with its jose JWKS
 * key set and cache — are instantiated ONCE and shared, not rebuilt
 * (and re-fetched) per importing module.
 *
 * `applyGlobal: false` is deliberate: the guards are registered as
 * APP_GUARDs in `AppModule` and calliope's own DomainErrorFilter
 * renders AuthGuardError (see AppModule / SharedHttpModule).
 */
export const sharedAuthGuard = AuthGuardModule.forRoot({
  jwksUrl: cerberusJwksUrl(),
  issuer: cerberusIssuer(),
  audience: cerberusAudience(),
  applyGlobal: false,
});
