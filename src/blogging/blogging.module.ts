import { Module } from '@nestjs/common';
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
import {
  cerberusAudience,
  cerberusIssuer,
  cerberusJwksUrl,
} from '../shared/infrastructure/config';

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
 * It is provided here (not in the root) so integration tests can stub
 * it without touching global auth wiring.
 */
@Module({
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
      useFactory: (): OptionalPrincipalResolver =>
        new JwksOptionalPrincipalResolver({
          jwksUrl: cerberusJwksUrl(),
          issuer: cerberusIssuer(),
          audience: cerberusAudience(),
          jwksCacheTtlMs: 30_000,
          jwksRequestTimeoutMs: 5_000,
        }),
    },
  ],
})
export class BloggingModule {}
