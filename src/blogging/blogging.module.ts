import { Module } from '@nestjs/common';
import { PrincipalProvider } from '@timonics/auth-guard';
import { JwksOptionalPrincipalResolver } from './application/optional-auth';
import { ArticlesService } from './application/articles.service';
import { AuthorsService } from './application/authors.service';
import { BlogsService } from './application/blogs.service';
import { CategoriesService } from './application/categories.service';
import { TagsService } from './application/tags.service';
import { ArticlesController } from './interfaces/http/articles.controller';
import { AuthorsController } from './interfaces/http/authors.controller';
import { BlogsController } from './interfaces/http/blogs.controller';
import { CategoriesController } from './interfaces/http/categories.controller';
import { TagsController } from './interfaces/http/tags.controller';
import {
  OPTIONAL_PRINCIPAL_RESOLVER,
  OptionalPrincipalResolver,
} from './application/optional-auth';
import { sharedAuthGuard } from '../shared/infrastructure/auth-guard.module';

/**
 * The blogging bounded context — blogs, authors, categories, tags,
 * articles. Layering:
 *
 *   domain/        pure invariants (status machine, related-ids rules,
 *                  slug policy) — no Nest, no Prisma
 *   application/   use-case services; PrismaService is the persistence
 *                  adapter (ports added only when a real seam appears)
 *   interfaces/    HTTP controllers + zod DTOs
 *
 * `OPTIONAL_PRINCIPAL_RESOLVER` backs the `@Public()` read routes that
 * upgrade to a management view when a valid Bearer token is presented.
 * It REUSES the shared `PrincipalProvider` from `sharedAuthGuard` (DI,
 * no second JWKS instance) and is provided here (not in the root) so
 * integration tests can stub it without touching global auth wiring.
 */
@Module({
  imports: [
    // Same dynamic-module reference as AppModule imports — Nest dedups
    // by module key, so PrincipalProvider (JWKS client + cache) is the
    // one shared instance, not a per-module rebuild.
    sharedAuthGuard,
  ],
  controllers: [
    BlogsController,
    AuthorsController,
    CategoriesController,
    TagsController,
    ArticlesController,
  ],
  providers: [
    BlogsService,
    AuthorsService,
    CategoriesService,
    TagsService,
    ArticlesService,
    {
      provide: OPTIONAL_PRINCIPAL_RESOLVER,
      useFactory: (provider: PrincipalProvider): OptionalPrincipalResolver =>
        new JwksOptionalPrincipalResolver(provider),
      inject: [PrincipalProvider],
    },
  ],
})
export class BloggingModule {}
