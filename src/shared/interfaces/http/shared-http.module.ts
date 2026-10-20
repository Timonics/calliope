import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DomainErrorFilter } from './domain-error.filter';

/**
 * Registers calliope's error-shape filter globally.
 *
 * `DomainErrorFilter` is the application's single catch-all: it renders
 * calliope's `DomainError`s, the auth-guard package's `AuthGuardError`s
 * and framework `HttpException`s uniformly as `{code, message}` with
 * one status table (see the filter's doc-comment). The package's own
 * `GlobalAuthExceptionFilter` is never registered — `sharedAuthGuard`
 * is built with `applyGlobal: false` — so there is no filter-ordering
 * race to manage.
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class SharedHttpModule {}
