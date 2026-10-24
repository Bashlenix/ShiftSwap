import { Injectable } from '@nestjs/common';
import type { DeactivationResult, MemberDto } from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/domain-error';
import type { Prisma } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { offerPayload } from '../offers/offer-notifications';
import { lockMembership, lockOffer, lockShift } from '../offers/offer-locks';
import {
  OFFER_INITIAL_STATUS,
  assertAcceptanceTransition,
  assertOfferTransition,
} from '../offers/offer-state';
import { offerAudit } from '../offers/offer-views';
import { OffersService } from '../offers/offers.service';
import { PrismaService } from '../prisma/prisma.service';
import { SHIFT_INCLUDE, toAuditSnapshot } from '../shifts/shift-mapper';
import type { OrgContext } from '../tenancy/org-context.decorator';
import { lockMemberAndAdmins, lockOpenInvites } from './admin-locks';
import { toMemberDto } from './members.service';

type Tx = Prisma.TransactionClient;

const RETRY = Symbol('retry');
const MAX_ATTEMPTS = 3;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (ids: Iterable<string>) => [...new Set(ids)].sort(byId);
const isSubset = (ids: Iterable<string>, of: readonly string[]) =>
  [...ids].every((id) => of.includes(id));

interface Affected {
  /** OPEN offers the member gives away or holds a PENDING acceptance on. */
  offers: {
    id: string;
    shiftId: string;
    kind: 'GIVE_AWAY' | 'OPEN_SHIFT';
    ownerId: string | null;
  }[];
  /** Future (startAt > now), non-deleted shifts assigned to the member. */
  futureShiftIds: string[];
}

/**
 * Member deactivation with offer conversion (FR-15, SDD §17) and reactivation.
 *
 * Lock order invite -> offer -> shift -> membership (SDD §25): the member's open invites are
 * locked first (accepting an invite locks invite -> membership), then the affected rows are
 * read unlocked and locked (offers ascending, shifts ascending, then target + active admins in
 * one ordered statement), then read again. A row that appeared in between (e.g. a claim
 * committed by the member) is not locked yet, so the transaction is retried before anything is
 * written. Once the membership row is held, approve/accept/claim for the member block on it
 * and afterwards see the member as DEACTIVATED.
 */
@Injectable()
export class DeactivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly offers: OffersService,
  ) {}

  async deactivate(org: OrgContext, membershipId: string): Promise<DeactivationResult> {
    for (let attempt = 1; ; attempt++) {
      const result = await this.prisma.$transaction((tx) =>
        this.deactivateOnce(tx, org, membershipId, new Date()),
      );
      if (result !== RETRY) return result;
      if (attempt >= MAX_ATTEMPTS) {
        throw new DomainError('VERSION_CONFLICT', 'The member was changed by someone else');
      }
    }
  }

  async reactivate(org: OrgContext, membershipId: string): Promise<MemberDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, org.orgId, membershipId);
      const m = await tx.membership.findUniqueOrThrow({
        where: { id: membershipId },
        include: { user: { select: { email: true } } },
      });
      if (m.accessLevel === 'ADMIN' && org.accessLevel !== 'ADMIN') {
        throw new DomainError('FORBIDDEN', 'Only an admin can reactivate an admin');
      }
      if (m.status !== 'DEACTIVATED') {
        throw new DomainError('INVALID_TRANSITION', 'Only deactivated members can be reactivated');
      }
      const emails = [
        ...new Set(
          [m.email, m.user?.email].filter((e): e is string => !!e).map((e) => e.toLowerCase()),
        ),
      ];
      if (emails.length > 0) {
        const taken = await tx.membership.findFirst({
          where: {
            organizationId: org.orgId,
            status: 'ACTIVE',
            id: { not: membershipId },
            OR: emails.flatMap((e) => [
              { email: { equals: e, mode: 'insensitive' as const } },
              { user: { email: { equals: e, mode: 'insensitive' as const } } },
            ]),
          },
          select: { id: true },
        });
        if (taken) {
          throw new DomainError(
            'ALREADY_MEMBER',
            'This email address now belongs to another active member.',
          );
        }
      }
      const updated = await tx.membership.update({
        where: { id: membershipId },
        data: { status: 'ACTIVE' },
        include: { skills: { select: { skillId: true } } },
      });
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'member.reactivated',
        entityType: 'membership',
        entityId: membershipId,
        before: { status: m.status },
        after: { status: updated.status },
      });
      const pending = await tx.invite.count({
        where: { membershipId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      return toMemberDto(updated, pending > 0);
    });
  }

  /* ------------------------------------------------------------------ deactivation */

  private async deactivateOnce(
    tx: Tx,
    org: OrgContext,
    membershipId: string,
    now: Date,
  ): Promise<DeactivationResult | typeof RETRY> {
    // 1. Open invites first; then an unlocked read of the affected set and the
    //    offer -> shift -> membership locks.
    await lockOpenInvites(tx, org.orgId, membershipId);
    const seen = await this.readAffected(tx, org.orgId, membershipId, now);
    const lockedOffers = sortedUnique(seen.offers.map((o) => o.id));
    const lockedShifts = sortedUnique([
      ...seen.futureShiftIds,
      ...seen.offers.map((o) => o.shiftId),
    ]);
    for (const id of lockedOffers) await lockOffer(tx, org.orgId, id);
    for (const id of lockedShifts) await lockShift(tx, org.orgId, id);
    const { target, activeAdminIds } = await lockMemberAndAdmins(tx, org.orgId, membershipId);

    // 2. Checks under the membership lock.
    if (target.accessLevel === 'ADMIN' && org.accessLevel !== 'ADMIN') {
      throw new DomainError('FORBIDDEN', 'Only an admin can deactivate an admin');
    }
    if (target.status !== 'ACTIVE') {
      throw new DomainError('INVALID_TRANSITION', 'This member is already deactivated');
    }
    if (target.accessLevel === 'ADMIN' && activeAdminIds.length <= 1) {
      throw new DomainError('LAST_ADMIN', 'The last admin cannot be deactivated');
    }
    if (target.id === org.membershipId) {
      throw new DomainError('INVALID_TRANSITION', 'You cannot deactivate yourself');
    }

    // 3. Re-read under the locks; anything we do not hold yet -> retry before writing.
    const current = await this.readAffected(tx, org.orgId, membershipId, now);
    if (
      !isSubset(
        current.offers.map((o) => o.id),
        lockedOffers,
      ) ||
      !isSubset([...current.futureShiftIds, ...current.offers.map((o) => o.shiftId)], lockedShifts)
    ) {
      return RETRY;
    }

    const giveAways = current.offers.filter(
      (o) => o.kind === 'GIVE_AWAY' && o.ownerId === membershipId,
    );
    const pendingOn = current.offers.filter((o) => !giveAways.includes(o));

    // (a) Cancel the member's open give-aways; their PENDING candidates are invalidated.
    for (const o of sortedById(giveAways)) await this.cancelGiveAway(tx, org, o.id, now);

    // (d) Withdraw the member's own PENDING acceptances on other offers.
    let withdrawnAcceptances = 0;
    for (const o of sortedById(pendingOn)) {
      withdrawnAcceptances += await this.withdrawAcceptance(tx, org, o.id, membershipId);
    }

    // (b) + (c) Unassign future shifts; repost each as an OPEN_SHIFT unless inside the lead time.
    const reposts: {
      offer: { id: string; kind: 'OPEN_SHIFT'; shiftId: string };
      shiftId: string;
    }[] = [];
    for (const shiftId of [...current.futureShiftIds].sort(byId)) {
      const offer = await this.unassignAndRepost(tx, org, shiftId, membershipId, now);
      if (offer) reposts.push({ offer, shiftId });
    }

    await tx.invite.updateMany({
      where: { organizationId: org.orgId, membershipId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.membership.update({ where: { id: membershipId }, data: { status: 'DEACTIVATED' } });

    const counts: DeactivationResult = {
      cancelledOffers: giveAways.length,
      reposted: reposts.length,
      unassigned: current.futureShiftIds.length,
      withdrawnAcceptances,
    };
    await this.audit.record(tx, {
      orgId: org.orgId,
      actorMembershipId: org.membershipId,
      action: 'member.deactivated',
      entityType: 'membership',
      entityId: membershipId,
      before: { status: 'ACTIVE' },
      after: { status: 'DEACTIVATED' },
      metadata: { ...counts },
    });

    // Notifications last, so eligibility already sees the member DEACTIVATED and shifts free.
    for (const r of reposts) {
      const shift = await tx.shift.findUniqueOrThrow({
        where: { id: r.shiftId },
        include: SHIFT_INCLUDE,
      });
      await this.offers.notifyCreated(tx, org, r.offer, shift);
    }
    await this.notifications.notify(
      tx,
      org.orgId,
      await this.notifications.managerIds(tx, org.orgId),
      'MEMBER_DEACTIVATED',
      {},
      org.membershipId,
    );
    return counts;
  }

  /** Org-scoped read of everything a deactivation touches (no locks). */
  private async readAffected(
    tx: Tx,
    orgId: string,
    membershipId: string,
    now: Date,
  ): Promise<Affected> {
    const offers = await tx.offer.findMany({
      where: {
        organizationId: orgId,
        status: 'OPEN',
        OR: [
          { kind: 'GIVE_AWAY', originalOwnerMembershipId: membershipId },
          {
            acceptances: {
              some: { organizationId: orgId, membershipId, status: 'PENDING' },
            },
          },
        ],
      },
      select: { id: true, shiftId: true, kind: true, originalOwnerMembershipId: true },
    });
    const shifts = await tx.shift.findMany({
      where: {
        organizationId: orgId,
        assignedMembershipId: membershipId,
        startAt: { gt: now },
        deletedAt: null,
      },
      select: { id: true },
    });
    return {
      offers: offers.map((o) => ({
        id: o.id,
        shiftId: o.shiftId,
        kind: o.kind,
        ownerId: o.originalOwnerMembershipId,
      })),
      futureShiftIds: shifts.map((s) => s.id),
    };
  }

  /** OPEN -> CANCELLED (OWNER_DEACTIVATED); PENDING -> INVALIDATED { code: 'OWNER_DEACTIVATED' }. */
  private async cancelGiveAway(tx: Tx, org: OrgContext, offerId: string, now: Date) {
    const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
    assertOfferTransition(offer.kind, offer.status, 'CANCELLED');
    const after = await tx.offer.update({
      where: { id: offerId },
      data: {
        status: 'CANCELLED',
        cancelReason: 'OWNER_DEACTIVATED',
        resolvedByMembershipId: org.membershipId,
        resolvedAt: now,
        version: { increment: 1 },
      },
    });
    const pending = await tx.acceptance.findMany({
      where: { offerId, status: 'PENDING' },
      select: { id: true, status: true, membershipId: true },
    });
    for (const a of pending) assertAcceptanceTransition(a.status, 'INVALIDATED');
    const invalidated = pending.map((a) => a.id);
    if (invalidated.length > 0) {
      await tx.acceptance.updateMany({
        where: { id: { in: invalidated }, status: 'PENDING' },
        data: { status: 'INVALIDATED', invalidatedReason: { code: 'OWNER_DEACTIVATED' } },
      });
    }
    await this.audit.record(tx, {
      orgId: org.orgId,
      actorMembershipId: org.membershipId,
      action: 'offer.cancelled',
      entityType: 'offer',
      entityId: offerId,
      before: offerAudit(offer),
      after: offerAudit(after),
      metadata: { reason: 'OWNER_DEACTIVATED', invalidatedAcceptanceIds: invalidated },
    });
    if (pending.length > 0) {
      const shift = await tx.shift.findUniqueOrThrow({
        where: { id: offer.shiftId },
        select: { startAt: true, endAt: true },
      });
      await this.notifications.notify(
        tx,
        org.orgId,
        pending.map((a) => a.membershipId),
        'ACCEPTANCE_INVALIDATED',
        { ...offerPayload(after, shift, 'candidate'), reason: 'OWNER_DEACTIVATED' },
        org.membershipId,
      );
    }
  }

  /** The member's PENDING acceptance on an OPEN offer -> WITHDRAWN. Returns 1 when changed. */
  private async withdrawAcceptance(
    tx: Tx,
    org: OrgContext,
    offerId: string,
    membershipId: string,
  ): Promise<number> {
    const acceptance = await tx.acceptance.findUnique({
      where: { offerId_membershipId: { offerId, membershipId } },
    });
    if (!acceptance || acceptance.status !== 'PENDING') return 0;
    assertAcceptanceTransition(acceptance.status, 'WITHDRAWN');
    await tx.acceptance.update({ where: { id: acceptance.id }, data: { status: 'WITHDRAWN' } });
    await this.audit.record(tx, {
      orgId: org.orgId,
      actorMembershipId: org.membershipId,
      action: 'acceptance.withdrawn',
      entityType: 'acceptance',
      entityId: acceptance.id,
      before: { offerId, status: acceptance.status },
      after: { offerId, status: 'WITHDRAWN' },
      metadata: { reason: 'MEMBER_DEACTIVATED' },
    });
    return 1;
  }

  /**
   * Unassigns the (locked) shift and, when `now < start - lead time` and the shift has no OPEN
   * offer left, posts it as an OPEN_SHIFT created by the acting manager. Returns the new offer.
   */
  private async unassignAndRepost(
    tx: Tx,
    org: OrgContext,
    shiftId: string,
    membershipId: string,
    now: Date,
  ): Promise<{ id: string; kind: 'OPEN_SHIFT'; shiftId: string } | null> {
    const before = await tx.shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: SHIFT_INCLUDE,
    });
    const { count } = await tx.shift.updateMany({
      where: {
        id: shiftId,
        organizationId: org.orgId,
        version: before.version,
        assignedMembershipId: membershipId,
      },
      data: { assignedMembershipId: null, version: { increment: 1 } },
    });
    if (count === 0) {
      // Unreachable while the shift row is locked; keep the write conditional anyway.
      throw new DomainError('VERSION_CONFLICT', 'The shift was changed by someone else');
    }
    const snapshot = toAuditSnapshot(before);
    await this.audit.record(tx, {
      orgId: org.orgId,
      actorMembershipId: org.membershipId,
      action: 'shift.updated',
      entityType: 'shift',
      entityId: shiftId,
      before: snapshot,
      after: { ...snapshot, assignedMembershipId: null },
      metadata: { reason: 'MEMBER_DEACTIVATED' },
    });

    const expiresAt = new Date(before.startAt.getTime() - org.leadTimeMin * 60_000);
    if (now >= expiresAt) return null;
    const stillOpen = await tx.offer.count({ where: { shiftId, status: 'OPEN' } });
    if (stillOpen > 0) return null;

    const offer = await tx.offer.create({
      data: {
        organizationId: org.orgId,
        shiftId,
        kind: 'OPEN_SHIFT',
        status: OFFER_INITIAL_STATUS,
        originalOwnerMembershipId: null,
        createdByMembershipId: org.membershipId,
        expiresAt,
      },
    });
    await this.audit.record(tx, {
      orgId: org.orgId,
      actorMembershipId: org.membershipId,
      action: 'offer.created',
      entityType: 'offer',
      entityId: offer.id,
      after: offerAudit(offer),
      metadata: { reason: 'MEMBER_DEACTIVATED' },
    });
    return { id: offer.id, kind: 'OPEN_SHIFT', shiftId };
  }
}

function sortedById<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => byId(a.id, b.id));
}
