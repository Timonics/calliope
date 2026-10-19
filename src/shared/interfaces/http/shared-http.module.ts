import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { DomainErrorFilter } from './domain-error.filter';

/**
 * Registers calliope's error-shape filter globally.
 *
 * Import order matters: this module must be imported BEFORE
 * `AuthGuardModule` in `AppModule`. Both this filter and the package's
 * `GlobalAuthExceptionFilter` are catch-alls — Nest dispatches to the
 * first registered matching filter, so calliope's wins and renders
 * everything (including the package's `AuthGuardError`) as
 * `{code, message}` with one consistent status table.
 */
@Module({
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class SharedHttpModule {}
