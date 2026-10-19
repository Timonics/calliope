import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthGuardModule,
  JwtAuthGuard,
  ScopesGuard,
} from '@timonics/auth-guard';
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module';
import { SharedHttpModule } from './shared/interfaces/http/shared-http.module';
import {
  cerberusAudience,
  cerberusIssuer,
  cerberusJwksUrl,
} from './shared/infrastructure/config';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    // applyGlobal: false — the guards are registered in `providers` below.
    // The package's convenience mode also registers its own catch-all
    // GlobalAuthExceptionFilter, which would claim Nest HttpExceptions
    // (e.g. 404 NotFoundException) and calliope's DomainErrors before
    // calliope's DomainErrorFilter sees them. SharedHttpModule's filter
    // already renders AuthGuardError itself, so no package filter needed.
    AuthGuardModule.forRoot({
      jwksUrl: cerberusJwksUrl(),
      issuer: cerberusIssuer(),
      audience: cerberusAudience(),
      applyGlobal: false,
    }),
    SharedHttpModule,
    PrismaModule,
    HealthModule,
  ],
  providers: [
    // Order matters: JwtAuthGuard must run before ScopesGuard.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: ScopesGuard },
  ],
})
export class AppModule {}
