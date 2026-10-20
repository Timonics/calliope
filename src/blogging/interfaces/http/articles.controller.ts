import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { CurrentPrincipal, Public, Scopes } from '@timonics/auth-guard';
import type { Principal } from '@timonics/auth-guard';
import type { Request, Response } from 'express';
import { ArticlesService } from '../../application/articles.service';
import { toPublicArticle } from '../../application/article-projection';
import { toPage, listEnvelope } from '../../application/pagination';
import { isUuid } from '../../application/id.util';
import { DomainError } from '../../../shared/kernel/domain-error';
import { OPTIONAL_PRINCIPAL_RESOLVER } from '../../application/optional-auth';
import type { OptionalPrincipalResolver } from '../../application/optional-auth';
import { resolveOptionalPrincipal } from './optional-principal.helper';
import {
  CreateArticleDto,
  GetArticleQueryDto,
  ListArticlesQueryDto,
  UpdateArticleDto,
} from './dto/articles.dto';

/**
 * Articles — one controller, two audiences:
 *
 *   * the read routes (`GET` list + detail) are `@Public()` and serve
 *     the PUBLIC projection to anonymous callers. When a Bearer token
 *     IS presented the same routes upgrade to the management view
 *     (all statuses, full records, tenancy enforced) — see
 *     `resolveOptionalPrincipal`;
 *   * UUID path params mean "management, by id"; anything else is a
 *     public slug lookup (published-only);
 *   * mutations require `content:write` like every other write route.
 */
@Controller('v1/blogs/:blogId/articles')
export class ArticlesController {
  public constructor(
    private readonly articles: ArticlesService,
    @Inject(OPTIONAL_PRINCIPAL_RESOLVER)
    private readonly optionalAuth: OptionalPrincipalResolver,
  ) {}

  @Public()
  @Get()
  public async list(
    @Req() request: Request,
    @Param('blogId') blogId: string,
    @Query() query: ListArticlesQueryDto,
  ) {
    const principal = await resolveOptionalPrincipal(
      request,
      this.optionalAuth,
    );
    const page = toPage(query);
    const { authorId, categoryId, tagId, q } = query;
    if (principal === undefined) {
      const { data, total } = await this.articles.listPublic(
        blogId,
        { authorId, categoryId, tagId, q },
        page,
      );
      return listEnvelope(
        data.map((article) => toPublicArticle(article)),
        total,
        page,
      );
    }
    const { data, total } = await this.articles.listManagement(
      blogId,
      principal.orgId,
      { status: query.status, authorId, categoryId, tagId, q },
      page,
    );
    return listEnvelope(data, total, page);
  }

  /**
   * `@Public()` detail route doubling as the management fetch:
   *
   *   * UUID param + token → full record, any status, tenancy enforced
   *     (wrong org → `blog.forbidden`);
   *   * UUID param, no token → `article.not_found` (ids are not public
   *     identifiers; anonymous callers get no existence signal);
   *   * UUID param + token but no article with that id → falls back to
   *     a public slug lookup before 404ing — a lowercase UUID is a
   *     valid slug shape, so a slug that happens to be UUID-formatted
   *     still resolves (permanent edge, public projection);
   *   * non-UUID param → public slug lookup, published-only, public
   *     projection; `?include=related` expands the curated related set
   *     inline (published related articles only, original order).
   */
  @Public()
  @Get(':idOrSlug')
  public async getOne(
    @Req() request: Request,
    @Param('blogId') blogId: string,
    @Param('idOrSlug') idOrSlug: string,
    @Query() query: GetArticleQueryDto,
  ) {
    const principal = await resolveOptionalPrincipal(
      request,
      this.optionalAuth,
    );
    if (isUuid(idOrSlug) && principal !== undefined) {
      try {
        return await this.articles.getManagement(
          blogId,
          principal.orgId,
          idOrSlug,
        );
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          error.code !== 'article.not_found'
        ) {
          throw error;
        }
        // fall through to the public slug lookup below
      }
    }
    if (isUuid(idOrSlug)) {
      // UUID param without a token: ids are not public identifiers.
      throw new DomainError(
        'article.not_found',
        `Article ${idOrSlug} does not exist`,
      );
    }
    const { article, related } = await this.articles.getPublicBySlug(
      blogId,
      idOrSlug,
      query.include === 'related',
    );
    return toPublicArticle(article, related ?? undefined);
  }

  /**
   * Management related-resolution: `relatedArticleIds` expanded to
   * full articles in curated order; dangling ids skipped silently.
   */
  @Get(':articleId/related')
  public related(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('articleId') articleId: string,
  ) {
    return this.articles.getRelated(blogId, principal.orgId, articleId);
  }

  /**
   * Idempotent create. Two client-controlled mechanisms (see
   * `ArticlesService.create`):
   *
   *   * `Idempotency-Key` request header — the first create stores
   *     (key, blog, endpoint → articleId) for 24h; a replay returns the
   *     stored article with **200** instead of creating a duplicate;
   *   * client-supplied `id` (UUID) in the body — used verbatim, with
   *     upsert-on-conflict semantics: a replay returns the existing
   *     article with **200**.
   *
   * A fresh create answers 201.
   */
  @Post()
  @Scopes('content:write')
  public async create(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Body() dto: CreateArticleDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { article, replayed } = await this.articles.create(
      blogId,
      principal.orgId,
      dto,
      idempotencyKey,
    );
    response.status(replayed ? 200 : 201);
    return article;
  }

  /**
   * Optimistic locking: `If-Match: <version>` (or a `version` field in
   * the body) makes the write conditional on the row still carrying
   * that version — a stale write is 409 `article.conflict`. Absent =
   * last-write-wins (the version still increments).
   */
  @Patch(':articleId')
  @Scopes('content:write')
  public async update(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('articleId') articleId: string,
    @Body() dto: UpdateArticleDto,
    @Headers('if-match') ifMatch: string | undefined,
  ) {
    const version = resolveExpectedVersion(dto.version, ifMatch);
    return this.articles.update(blogId, principal.orgId, articleId, {
      ...dto,
      ...(version === undefined ? {} : { version }),
    });
  }

  @Delete(':articleId')
  @Scopes('content:write')
  @HttpCode(204)
  public async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('articleId') articleId: string,
  ): Promise<void> {
    await this.articles.remove(blogId, principal.orgId, articleId);
  }
}

/**
 * Combine the `If-Match` header and the body `version` field into the
 * expected-version number. A non-numeric header is a 400 — a garbage
 * precondition is an input error, not a conflict.
 */
function resolveExpectedVersion(
  bodyVersion: number | undefined,
  ifMatch: string | undefined,
): number | undefined {
  if (ifMatch === undefined) {
    return bodyVersion;
  }
  const trimmed = ifMatch.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new DomainError(
      'http.validation.failed',
      `If-Match must be a non-negative integer version, got "${ifMatch}"`,
    );
  }
  return Number(trimmed);
}
