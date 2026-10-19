import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ZodValidationPipe } from './shared/interfaces/http/zod-validation.pipe';
import { port } from './shared/infrastructure/config';

/**
 * Process entrypoint. Single HTTP listener — no global prefix; API
 * versions live in route paths explicitly (`@Controller('v1/...')`),
 * matching cerberus.
 *
 * Error filtering is NOT registered here: `DomainErrorFilter` is an
 * APP_FILTER in `SharedHttpModule` (imported first in `AppModule` so it
 * wins dispatch over the auth-guard package's catch-all filter).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

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
