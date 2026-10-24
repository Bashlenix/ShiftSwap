import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createMemberSchema,
  resendInviteSchema,
  updateMemberSchema,
  type CreateMemberInput,
  type CreateMemberResponse,
  type MemberDto,
  type ResendInviteInput,
  type UpdateMemberInput,
} from '@shiftswap/shared';
import { SessionGuard } from '../auth/session.guard';
import { ZodBody } from '../common/zod-body.pipe';
import { MinAccess } from '../tenancy/min-access.decorator';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';
import { MembersService } from './members.service';

@Controller('orgs/:orgId/members')
@UseGuards(SessionGuard, OrgGuard)
@MinAccess('MANAGER')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@Org() org: OrgContext, @Query('status') status?: string): Promise<MemberDto[]> {
    return this.members.list(org.orgId, status === 'all' ? 'all' : 'active');
  }

  @Post()
  @HttpCode(201)
  create(
    @Org() org: OrgContext,
    @Body(ZodBody(createMemberSchema)) body: CreateMemberInput,
  ): Promise<CreateMemberResponse> {
    return this.members.create(org, body);
  }

  @Patch(':membershipId')
  update(
    @Org() org: OrgContext,
    @Param('membershipId') membershipId: string,
    @Body(ZodBody(updateMemberSchema)) body: UpdateMemberInput,
  ): Promise<MemberDto> {
    return this.members.update(org, membershipId, body);
  }

  @Post(':membershipId/invite')
  @HttpCode(201)
  resend(
    @Org() org: OrgContext,
    @Param('membershipId') membershipId: string,
    @Body(ZodBody(resendInviteSchema)) body: ResendInviteInput,
  ): Promise<{ inviteLink: string }> {
    return this.members.resendInvite(org, membershipId, body);
  }
}
