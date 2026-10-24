import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccessLevel } from '@shiftswap/shared';
import type { AuthedRequest } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import { MIN_ACCESS_KEY } from './min-access.decorator';
import type { OrgRequest } from './org-context.decorator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK: Record<AccessLevel, number> = { EMPLOYEE: 0, MANAGER: 1, ADMIN: 2 };

/**
 * The single tenant-isolation choke point. Must run after SessionGuard
 * (`@UseGuards(SessionGuard, OrgGuard)`). Non-member, deactivated and unknown orgs all
 * look the same: 404 NOT_FOUND.
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest & Partial<OrgRequest>>();
    const user = req.user;
    // Misconfiguration (SessionGuard missing) must fail closed.
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Not signed in');

    const orgId = (req.params as Record<string, string | undefined>).orgId;
    if (typeof orgId !== 'string' || !UUID.test(orgId)) {
      throw new DomainError('NOT_FOUND', 'Not found');
    }

    const membership = await this.prisma.membership.findFirst({
      where: { organizationId: orgId, userId: user.id, status: 'ACTIVE' },
      include: { organization: true },
    });
    if (!membership) throw new DomainError('NOT_FOUND', 'Not found');

    const required =
      this.reflector.getAllAndOverride<AccessLevel | undefined>(MIN_ACCESS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'EMPLOYEE';
    if (RANK[membership.accessLevel] < RANK[required]) {
      throw new DomainError('FORBIDDEN', 'Insufficient access level');
    }

    const org = membership.organization;
    req.org = {
      orgId,
      membershipId: membership.id,
      accessLevel: membership.accessLevel,
      timezone: org.timezone,
      policy: {
        timezone: org.timezone,
        defaultWeeklyLimitMin: org.defaultWeeklyLimitMin,
        minRestMin: org.minRestMin,
        maxDailyMin: org.maxDailyMin,
      },
      leadTimeMin: org.offerLeadTimeMin,
    };
    return true;
  }
}
