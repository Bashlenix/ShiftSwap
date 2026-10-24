import type { Membership, Organization } from '../generated/prisma/client';
import type { OrgContext } from './org-context.decorator';

/** The request's org context for an ACTIVE membership (OrgGuard; account deletion). */
export function toOrgContext(m: Membership & { organization: Organization }): OrgContext {
  const org = m.organization;
  return {
    orgId: m.organizationId,
    membershipId: m.id,
    accessLevel: m.accessLevel,
    timezone: org.timezone,
    policy: {
      timezone: org.timezone,
      defaultWeeklyLimitMin: org.defaultWeeklyLimitMin,
      minRestMin: org.minRestMin,
      maxDailyMin: org.maxDailyMin,
    },
    leadTimeMin: org.offerLeadTimeMin,
  };
}
