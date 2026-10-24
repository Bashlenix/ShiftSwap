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
  type DeactivationResult,
  type MemberDto,
  type ResendInviteInput,
  type UpdateMemberInput,
} from '@shiftswap/shared';
import { SessionGuard } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import { ZodBody } from '../common/zod-body.pipe';
import { MinAccess } from '../tenancy/min-access.decorator';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';
import { DeactivationService } from './deactivation.service';
import { MembersService } from './members.service';

@Controller('orgs/:orgId/members')
@UseGuards(SessionGuard, OrgGuard)
@MinAccess('MANAGER')
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly deactivation: DeactivationService,
  ) {}

  @Get()
  list(@Org() org: OrgContext, @Query('status') status?: string): Promise<MemberDto[]> {
    if (status !== undefined && !['active', 'deactivated', 'all'].includes(status)) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: [{ path: 'status', message: 'Use active, deactivated or all' }],
      });
    }
    return this.members.list(org.orgId, (status as 'active' | 'deactivated' | 'all') ?? 'active');
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

  /** Deactivating an ADMIN additionally requires ADMIN (checked in the service). */
  @Post(':membershipId/deactivate')
  @HttpCode(200)
  deactivate(
    @Org() org: OrgContext,
    @Param('membershipId') membershipId: string,
  ): Promise<DeactivationResult> {
    return this.deactivation.deactivate(org, membershipId);
  }

  @Post(':membershipId/reactivate')
  @HttpCode(200)
  reactivate(
    @Org() org: OrgContext,
    @Param('membershipId') membershipId: string,
  ): Promise<MemberDto> {
    return this.deactivation.reactivate(org, membershipId);
  }
}
