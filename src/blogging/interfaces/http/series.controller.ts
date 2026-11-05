import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentPrincipal, Public, Scopes } from '@timonics/auth-guard';
import type { Principal } from '@timonics/auth-guard';
import { SeriesService } from '../../application/series.service';
import { toPublicArticle } from '../../application/article-projection';
import { CreateSeriesDto } from './dto/series.dto';

/**
 * Series — a named sequence of articles within a blog.
 *
 *   * `GET /v1/blogs/:blogId/series/:slug` is `@Public()` and answers the
 *     §2b contract shape: `{ data: { id, name, slug, articles }, meta }`
 *     with published articles ordered by series position and a fixed
 *     `page: 1, pageSize: 100` window (the contract fixes the page
 *     size; series stay small by design);
 *   * `POST` is management-only (`content:write`) — the tenant is the
 *     principal's organization, as everywhere else.
 */
@Controller('v1/blogs/:blogId/series')
export class SeriesController {
  public constructor(private readonly series: SeriesService) {}

  @Public()
  @Get(':slug')
  public async getBySlug(
    @Param('blogId') blogId: string,
    @Param('slug') slug: string,
  ) {
    const { series, articles } = await this.series.getPublicBySlug(
      blogId,
      slug,
    );
    // Every article here belongs to this one series and is published,
    // so the published count the projection needs IS the page total.
    const seriesTotals = new Map([[series.id, articles.length]]);
    return {
      data: {
        id: series.id,
        name: series.name,
        slug: series.slug,
        articles: articles.map((article) =>
          toPublicArticle(article, seriesTotals),
        ),
      },
      meta: { total: articles.length, page: 1, pageSize: 100 },
    };
  }

  @Post()
  @Scopes('content:write')
  public create(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Body() dto: CreateSeriesDto,
  ) {
    return this.series.create(blogId, principal.orgId, dto);
  }
}
