import { Injectable } from '@nestjs/common';
import type { CreateOrgInput, OrgDto, OrgSettingsInput } from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import type { Organization } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OrgContext } from '../tenancy/org-context.decorator';
import { canonicalTimeZone } from './time-zone';

const SETTINGS = [
  'name',
  'timezone',
  'defaultWeeklyLimitMin',
  'minRestMin',
  'maxDailyMin',
  'offerLeadTimeMin',
] as const satisfies readonly (keyof OrgSettingsInput & keyof Organization)[];
type Setting = (typeof SETTINGS)[number];

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

  /**
   * Updates the org's settings (FR-04). When `offerLeadTimeMin` changes, the expiry of every
   * OPEN offer is recomputed in the same transaction (`start - lead time`, version + 1), so an
   * offer now past its new expiry answers OFFER_EXPIRED. Audits only the changed fields.
   *
   * Lock order: the org's OPEN offers ascending by id (the same order deactivation and the
   * expiry sweep use, so no deadlock with them), then the organization row.
   */
  async update(org: OrgContext, input: OrgSettingsInput): Promise<OrgDto> {
    const next: Partial<Record<Setting, string | number>> = {
      ...input,
      ...(input.timezone !== undefined ? { timezone: canonicalTimeZone(input.timezone) } : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const lockedOfferIds =
          input.offerLeadTimeMin === undefined
            ? []
            : (
                await tx.$queryRaw<{ id: string }[]>`
                SELECT id FROM "offers"
                 WHERE organization_id = ${org.orgId} AND status = 'OPEN'
                 ORDER BY id FOR UPDATE`
              ).map((r) => r.id);
        await tx.$queryRaw`
        SELECT id FROM "organizations" WHERE id = ${org.orgId} FOR NO KEY UPDATE`;
        const current = await tx.organization.findUniqueOrThrow({ where: { id: org.orgId } });
        const changed = SETTINGS.filter((k) => next[k] !== undefined && next[k] !== current[k]);
        if (changed.length === 0) return toOrgDto(current);

        const data = Object.fromEntries(changed.map((k) => [k, next[k]]));
        const updated = await tx.organization.update({ where: { id: org.orgId }, data });
        if (changed.includes('offerLeadTimeMin') && lockedOfferIds.length > 0) {
          await tx.$executeRaw`
          UPDATE "offers" o
             SET expires_at = s.start_at - make_interval(mins => ${updated.offerLeadTimeMin}::int),
                 version = o.version + 1,
                 updated_at = now()
            FROM "shifts" s
           WHERE o.shift_id = s.id
             AND o.id = ANY(${lockedOfferIds}::text[])
             AND o.status = 'OPEN'
             AND o.organization_id = ${org.orgId}`;
        }
        await this.audit.record(tx, {
          orgId: org.orgId,
          actorMembershipId: org.membershipId,
          action: 'org.updated',
          entityType: 'organization',
          entityId: org.orgId,
          before: Object.fromEntries(changed.map((k) => [k, current[k]])),
          after: Object.fromEntries(changed.map((k) => [k, updated[k]])),
        });
        return toOrgDto(updated);
      },
      // Locks every OPEN offer of the org: Prisma's default 5 s timeout is too short.
      { timeout: 15_000 },
    );
  }
}
