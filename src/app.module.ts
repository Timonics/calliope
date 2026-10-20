import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard, ScopesGuard } from '@timonics/auth-guard';
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module';
import { SharedHttpModule } from './shared/interfaces/http/shared-http.module';
import { sharedAuthGuard } from './shared/infrastructure/auth-guard.module';
import { HealthModule } from './health/health.module';
import { BloggingModule } from './blogging/blogging.module';

@Module({
  imports: [
    // applyGlobal: false — the guards are registered in `providers`
    // below. The package's convenience mode also registers its own
    // catch-all GlobalAuthExceptionFilter, which would claim Nest
    // HttpExceptions (e.g. 404 NotFoundException) and calliope's
    // DomainErrors before calliope's DomainErrorFilter sees them.
    // SharedHttpModule's filter already renders AuthGuardError itself,
    // so no package filter needed. `sharedAuthGuard` is the same
    // dynamic-module object BloggingModule imports, so the package's
    // providers (JWKS client, cache) are one shared instance.
    sharedAuthGuard,
    SharedHttpModule,
    PrismaModule,
    HealthModule,
    BloggingModule,
  ],
  providers: [
    // Order matters: JwtAuthGuard must run before ScopesGuard.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: ScopesGuard },
  ],
})
export class AppModule {}
