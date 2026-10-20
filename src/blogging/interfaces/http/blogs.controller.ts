import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentPrincipal, Scopes } from '@timonics/auth-guard';
import type { Principal } from '@timonics/auth-guard';
import { BlogsService } from '../../application/blogs.service';
import { toPage } from '../../application/pagination';
import { CreateBlogDto, ListBlogsQueryDto } from './dto/blogs.dto';

/**
 * Blog management — every route requires a Bearer token; the tenant is
 * ALWAYS the principal's organization (`tenantId = principal.orgId`).
 */
@Controller('v1/blogs')
export class BlogsController {
  public constructor(private readonly blogs: BlogsService) {}

  @Post()
  @Scopes('content:write')
  public create(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: CreateBlogDto,
  ) {
    return this.blogs.create(principal.orgId, dto);
  }

  @Get()
  public list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListBlogsQueryDto,
  ) {
    return this.blogs.list(principal.orgId, toPage(query));
  }

  @Get(':blogId')
  public get(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
  ) {
    return this.blogs.get(blogId, principal.orgId);
  }
}
