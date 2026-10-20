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
import { TagsService } from '../../application/tags.service';
import { toPage, listEnvelope } from '../../application/pagination';
import { OPTIONAL_PRINCIPAL_RESOLVER } from '../../application/optional-auth';
import type { OptionalPrincipalResolver } from '../../application/optional-auth';
import { resolveOptionalPrincipal } from './optional-principal.helper';
import { CreateTagDto, ListTagsQueryDto, UpdateTagDto } from './dto/tags.dto';

@Controller('v1/blogs/:blogId/tags')
export class TagsController {
  public constructor(
    private readonly tags: TagsService,
    @Inject(OPTIONAL_PRINCIPAL_RESOLVER)
    private readonly optionalAuth: OptionalPrincipalResolver,
  ) {}

  /**
   * `{data, meta}` envelope (see `AuthorsController.list`). Public
   * items use the whitelist projection (id/name/slug).
   */
  @Public()
  @Get()
  public async list(
    @Req() request: Request,
    @Param('blogId') blogId: string,
    @Query() query: ListTagsQueryDto,
  ) {
    const principal = await resolveOptionalPrincipal(
      request,
      this.optionalAuth,
    );
    const page = toPage(query);
    const { data, total } = await this.tags.list(
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
    @Body() dto: CreateTagDto,
  ) {
    return this.tags.create(blogId, principal.orgId, dto);
  }

  @Patch(':tagId')
  @Scopes('content:write')
  public update(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('tagId') tagId: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tags.update(blogId, principal.orgId, tagId, dto);
  }

  @Delete(':tagId')
  @Scopes('content:write')
  @HttpCode(204)
  public async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('tagId') tagId: string,
  ): Promise<void> {
    await this.tags.remove(blogId, principal.orgId, tagId);
  }
}
