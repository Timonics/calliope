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
import { CategoriesService } from '../../application/categories.service';
import { toPage, listEnvelope } from '../../application/pagination';
import { OPTIONAL_PRINCIPAL_RESOLVER } from '../../application/optional-auth';
import type { OptionalPrincipalResolver } from '../../application/optional-auth';
import { resolveOptionalPrincipal } from './optional-principal.helper';
import {
  CreateCategoryDto,
  ListCategoriesQueryDto,
  UpdateCategoryDto,
} from './dto/categories.dto';

@Controller('v1/blogs/:blogId/categories')
export class CategoriesController {
  public constructor(
    private readonly categories: CategoriesService,
    @Inject(OPTIONAL_PRINCIPAL_RESOLVER)
    private readonly optionalAuth: OptionalPrincipalResolver,
  ) {}

  /**
   * `{data, meta}` envelope (see `AuthorsController.list`). Public
   * items use the whitelist projection (id/name/slug/description).
   */
  @Public()
  @Get()
  public async list(
    @Req() request: Request,
    @Param('blogId') blogId: string,
    @Query() query: ListCategoriesQueryDto,
  ) {
    const principal = await resolveOptionalPrincipal(
      request,
      this.optionalAuth,
    );
    const page = toPage(query);
    const { data, total } = await this.categories.list(
      blogId,
      principal?.orgId,
      page,
    );
    return listEnvelope(data, total, page);
  }

  @Post()
  @Scopes('content:write')
  public create(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.categories.create(blogId, principal.orgId, dto);
  }

  @Patch(':categoryId')
  @Scopes('content:write')
  public update(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(blogId, principal.orgId, categoryId, dto);
  }

  @Delete(':categoryId')
  @Scopes('content:write')
  @HttpCode(204)
  public async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('categoryId') categoryId: string,
  ): Promise<void> {
    await this.categories.remove(blogId, principal.orgId, categoryId);
  }
}
