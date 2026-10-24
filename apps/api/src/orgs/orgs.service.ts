import { Injectable } from '@nestjs/common';
import type { CreateOrgInput, OrgDto } from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import type { Organization } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { canonicalTimeZone } from './time-zone';

export const toOrgDto = (o: Organization): OrgDto => ({
  id: o.id,
  name: o.name,
  timezone: o.timezone,
  defaultWeeklyLimitMin: o.defaultWeeklyLimitMin,
  minRestMin: o.minRestMin,
  maxDailyMin: o.maxDailyMin,
  offerLeadTimeMin: o.offerLeadTimeMin,
});

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, input: CreateOrgInput): Promise<OrgDto> {
    const timezone = canonicalTimeZone(input.timezone);
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.name, timezone } });
      const membership = await tx.membership.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          displayName: user.name,
          email: user.email,
          accessLevel: 'ADMIN',
        },
      });
      // Org name is business data, not personal; still no member names or emails here.
      await this.audit.record(tx, {
        orgId: org.id,
        actorMembershipId: membership.id,
        action: 'org.created',
        entityType: 'organization',
        entityId: org.id,
        metadata: { name: org.name, timezone },
      });
      return toOrgDto(org);
    });
  }

  async get(orgId: string): Promise<OrgDto> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new DomainError('NOT_FOUND', 'Not found');
    return toOrgDto(org);
  }
}
