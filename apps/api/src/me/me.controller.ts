import { Body, Controller, Delete, Get, HttpCode, UseGuards } from '@nestjs/common';
import { deleteAccountSchema, type DeleteAccountInput } from '@shiftswap/shared';
import { AccountService } from '../account/account.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard, type AuthUser } from '../auth/session.guard';
import { ZodBody } from '../common/zod-body.pipe';
import { PrismaService } from '../prisma/prisma.service';

export interface MeResponse {
  user: AuthUser;
  memberships: {
    membershipId: string;
    organizationTimezone: string;
    offerLeadTimeMin: number;
    organizationId: string;
    organizationName: string;
    accessLevel: 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  }[];
}

@Controller('me')
@UseGuards(SessionGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly account: AccountService,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    const rows = await this.prisma.membership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { organization: true },
      orderBy: { organization: { name: 'asc' } },
    });
    return {
      user,
      memberships: rows.map((m) => ({
        membershipId: m.id,
        organizationTimezone: m.organization.timezone,
        offerLeadTimeMin: m.organization.offerLeadTimeMin,
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        accessLevel: m.accessLevel,
      })),
    };
  }

  /** Deletes and anonymises the signed-in account (FR-23). 409 LAST_ADMIN blocks it. */
  @Delete()
  @HttpCode(204)
  async deleteMe(
    @CurrentUser() user: AuthUser,
    // Validation only: the body is the typed confirmation, nothing to read from it.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Body(ZodBody(deleteAccountSchema)) _confirm: DeleteAccountInput,
  ): Promise<void> {
    await this.account.deleteAccount(user.id);
  }
}
