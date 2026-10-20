import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { CurrentPrincipal, Public, Scopes } from '@timonics/auth-guard';
import type { Principal } from '@timonics/auth-guard';
import type { Request } from 'express';
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
    if (isUuid(idOrSlug)) {
      if (principal === undefined) {
        throw new DomainError(
          'article.not_found',
          `Article ${idOrSlug} does not exist`,
        );
      }
      return this.articles.getManagement(blogId, principal.orgId, idOrSlug);
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

  @Post()
  @Scopes('content:write')
  public create(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Body() dto: CreateArticleDto,
  ) {
    return this.articles.create(blogId, principal.orgId, dto);
  }

  @Patch(':articleId')
  @Scopes('content:write')
  public update(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('articleId') articleId: string,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articles.update(blogId, principal.orgId, articleId, dto);
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
