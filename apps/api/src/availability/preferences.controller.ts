import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import {
  PREFERENCE_SLOTS,
  preferenceGridSchema,
  type PreferenceEntry,
  type PreferenceGridDto,
} from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { ZodBody } from '../common/zod-body.pipe';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';

const sortEntries = (entries: PreferenceEntry[]): PreferenceEntry[] =>
  [...entries].sort(
    (a, b) =>
      a.weekday - b.weekday || PREFERENCE_SLOTS.indexOf(a.slot) - PREFERENCE_SLOTS.indexOf(b.slot),
  );

const read = async (
  db: Pick<Prisma.TransactionClient, 'preference'>,
  org: OrgContext,
): Promise<PreferenceGridDto> => {
  const rows = await db.preference.findMany({
    where: { organizationId: org.orgId, membershipId: org.membershipId },
  });
  return {
    entries: sortEntries(rows.map((r) => ({ weekday: r.weekday, slot: r.slot, value: r.value }))),
  };
};

/** Own weekly preference grid; open to every access level. Absent row = neutral. */
@Controller('orgs/:orgId/me/preferences')
@UseGuards(SessionGuard, OrgGuard)
export class PreferencesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get(@Org() org: OrgContext): Promise<PreferenceGridDto> {
    return read(this.prisma, org);
  }

  @Put()
  replace(
    @Org() org: OrgContext,
    @Body(ZodBody(preferenceGridSchema)) body: PreferenceGridDto,
  ): Promise<PreferenceGridDto> {
    return this.prisma.$transaction(async (tx) => {
      const before = await read(tx, org);
      await tx.preference.deleteMany({
        where: { organizationId: org.orgId, membershipId: org.membershipId },
      });
      await tx.preference.createMany({
        data: body.entries.map((e) => ({
          organizationId: org.orgId,
          membershipId: org.membershipId,
          weekday: e.weekday,
          slot: e.slot,
          value: e.value,
        })),
      });
      const after = { entries: sortEntries(body.entries) };
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'preferences.updated',
        entityType: 'membership',
        entityId: org.membershipId,
        before,
        after,
      });
      return after;
    });
  }
}
