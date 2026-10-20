import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { ZodValidationPipe } from './shared/interfaces/http/zod-validation.pipe';
import { port } from './shared/infrastructure/config';

/**
 * Process entrypoint. Single HTTP listener — no global prefix; API
 * versions live in route paths explicitly (`@Controller('v1/...')`),
 * matching cerberus.
 *
 * Error filtering is NOT registered here: `DomainErrorFilter` is an
 * APP_FILTER in `SharedHttpModule`. The auth-guard package's own
 * catch-all filter is never registered because `sharedAuthGuard` is
 * built with `applyGlobal: false` (the guards are APP_GUARDs in
 * `AppModule`); DomainErrorFilter renders AuthGuardError itself.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Hard body-size cap — applied BEFORE any controller middleware so
  // oversized payloads are rejected at the edge (payload-too-large)
  // instead of being parsed and validated first.
  app.use(json({ limit: '1mb' }));
  // zod is the only validation layer (no class-validator).
  app.useGlobalPipes(new ZodValidationPipe());
  // Drain in-flight requests on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  await app.listen(port());
}

bootstrap().catch((err: unknown) => {
  console.error('[bootstrap] fatal error', err);
  process.exit(1);
});
