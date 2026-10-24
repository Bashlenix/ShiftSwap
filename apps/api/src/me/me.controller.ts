import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard, type AuthUser } from '../auth/session.guard';
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
  constructor(private readonly prisma: PrismaService) {}

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
}
