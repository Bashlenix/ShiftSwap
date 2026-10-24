import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { createOrgSchema, type CreateOrgInput, type OrgDto } from '@shiftswap/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard, type AuthUser } from '../auth/session.guard';
import { ZodBody } from '../common/zod-body.pipe';
import { MinAccess } from '../tenancy/min-access.decorator';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';
import { OrgsService } from './orgs.service';

@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /** Not org-scoped: any signed-in user may start a new organisation. */
  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Body(ZodBody(createOrgSchema)) body: CreateOrgInput,
  ): Promise<OrgDto> {
    return this.orgs.create(user, body);
  }

  @Get(':orgId')
  @UseGuards(SessionGuard, OrgGuard)
  @MinAccess('EMPLOYEE')
  get(@Org() org: OrgContext): Promise<OrgDto> {
    return this.orgs.get(org.orgId);
  }
}
