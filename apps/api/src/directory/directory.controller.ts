import { Controller, Get, UseGuards } from '@nestjs/common';
import type { SkillDto } from '@shiftswap/shared';
import { SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MinAccess } from '../tenancy/min-access.decorator';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';

@Controller('orgs/:orgId')
@UseGuards(SessionGuard, OrgGuard)
export class DirectoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('skills')
  @MinAccess('EMPLOYEE')
  async skills(@Org() org: OrgContext): Promise<SkillDto[]> {
    const rows = await this.prisma.skill.findMany({
      where: { organizationId: org.orgId },
      orderBy: { name: 'asc' },
    });
    return rows.map((s) => ({ id: s.id, name: s.name }));
  }
}
