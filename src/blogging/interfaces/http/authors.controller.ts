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
import { AuthorsService } from '../../application/authors.service';
import { toPage } from '../../application/pagination';
import { OPTIONAL_PRINCIPAL_RESOLVER } from '../../application/optional-auth';
import type { OptionalPrincipalResolver } from '../../application/optional-auth';
import { resolveOptionalPrincipal } from './optional-principal.helper';
import {
  CreateAuthorDto,
  ListAuthorsQueryDto,
  UpdateAuthorDto,
} from './dto/authors.dto';

@Controller('v1/blogs/:blogId/authors')
export class AuthorsController {
  public constructor(
    private readonly authors: AuthorsService,
    @Inject(OPTIONAL_PRINCIPAL_RESOLVER)
    private readonly optionalAuth: OptionalPrincipalResolver,
  ) {}

  /**
   * Public list (no token) — identical payload for management; when a
   * Bearer token IS presented the tenancy check runs and a wrong-org
   * caller gets `blog.forbidden` (403) instead of the list.
   */
  @Public()
  @Get()
  public async list(
    @Req() request: Request,
    @Param('blogId') blogId: string,
    @Query() query: ListAuthorsQueryDto,
  ) {
    const principal = await resolveOptionalPrincipal(
      request,
      this.optionalAuth,
    );
    return this.authors.list(blogId, principal?.orgId, toPage(query));
  }

  @Post()
  @Scopes('content:write')
  public create(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Body() dto: CreateAuthorDto,
  ) {
    return this.authors.create(blogId, principal.orgId, dto);
  }

  @Patch(':authorId')
  @Scopes('content:write')
  public update(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('authorId') authorId: string,
    @Body() dto: UpdateAuthorDto,
  ) {
    return this.authors.update(blogId, principal.orgId, authorId, dto);
  }

  @Delete(':authorId')
  @Scopes('content:write')
  @HttpCode(204)
  public async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('blogId') blogId: string,
    @Param('authorId') authorId: string,
  ): Promise<void> {
    await this.authors.remove(blogId, principal.orgId, authorId);
  }
}
