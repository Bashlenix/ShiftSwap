import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/domain-error';
import { DeactivationService } from '../members/deactivation.service';
import { PrismaService } from '../prisma/prisma.service';
import { toOrgContext } from '../tenancy/org-context';

export const DELETED_NAME = 'Deleted user';
/** `users.email` is unique and non-null, so the anonymised address keeps the user id. */
export const tombstoneEmail = (userId: string) => `deleted-${userId}@deleted.invalid`;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Account deletion (FR-23, SDD §27/§35): every ACTIVE membership goes through the FR-15
 * conversion (one transaction each), then one final transaction anonymises the user, their
 * memberships and invites and deletes sessions and credential accounts. A repeat after a
 * partial failure completes: already deactivated memberships are skipped.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly deactivation: DeactivationService,
  ) {}

  async deleteAccount(userId: string): Promise<void> {
    const active = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { organization: true },
    });
    active.sort((a, b) => byId(a.organizationId, b.organizationId));

    // Fail fast with every blocking org before anything changes. Deactivation re-checks
    // LAST_ADMIN under its lock, so a concurrent demotion is still caught (see below).
    const lastAdminOf: string[] = [];
    for (const m of active.filter((x) => x.accessLevel === 'ADMIN')) {
      const others = await this.prisma.membership.count({
        where: {
          organizationId: m.organizationId,
          accessLevel: 'ADMIN',
          status: 'ACTIVE',
          id: { not: m.id },
        },
      });
      if (others === 0) lastAdminOf.push(m.organizationId);
    }
    if (lastAdminOf.length > 0) throw lastAdmin(lastAdminOf);

    for (const m of active) {
      try {
        await this.deactivation.deactivate(toOrgContext(m), m.id, { selfDeletion: true });
      } catch (e) {
        if (e instanceof DomainError && e.code === 'LAST_ADMIN')
          throw lastAdmin([m.organizationId]);
        throw e;
      }
    }

    await this.anonymise(userId);
  }

  /**
   * Lock order invites -> memberships -> user (global order; invite accept locks
   * invite -> membership and only then touches the user row via the FK).
   */
  private async anonymise(userId: string): Promise<void> {
    const tombstone = tombstoneEmail(userId);
    await this.prisma.$transaction(async (tx) => {
      const memberships = await tx.membership.findMany({
        where: { userId },
        select: { id: true, organizationId: true },
      });
      const ids = memberships.map((m) => m.id).sort(byId);
      if (ids.length > 0) {
        await tx.$queryRaw`
          SELECT id FROM "invites" WHERE membership_id = ANY(${ids}::text[])
           ORDER BY id FOR UPDATE`;
        await tx.$queryRaw`
          SELECT id FROM "memberships" WHERE id = ANY(${ids}::text[])
           ORDER BY id FOR NO KEY UPDATE`;
        await tx.invite.updateMany({
          where: { membershipId: { in: ids } },
          data: { email: tombstone },
        });
        await tx.membership.updateMany({
          where: { id: { in: ids } },
          data: { displayName: DELETED_NAME, email: null },
        });
      }
      await tx.user.update({
        where: { id: userId },
        data: {
          name: DELETED_NAME,
          email: tombstone,
          emailVerified: false,
          image: null,
          deletedAt: new Date(),
        },
      });
      await tx.session.deleteMany({ where: { userId } });
      await tx.account.deleteMany({ where: { userId } });
      for (const m of [...memberships].sort((a, b) => byId(a.id, b.id))) {
        await this.audit.record(tx, {
          orgId: m.organizationId,
          actorMembershipId: m.id,
          action: 'member.anonymised',
          entityType: 'membership',
          entityId: m.id,
        });
      }
    });
  }
}

function lastAdmin(organizationIds: string[]): DomainError {
  return new DomainError('LAST_ADMIN', 'You are the last admin of an organization', {
    organizationIds: [...organizationIds].sort(byId),
  });
}
