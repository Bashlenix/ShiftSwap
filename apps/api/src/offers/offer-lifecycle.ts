import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { Prisma } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { lockOffer } from './offer-locks';
import { assertAcceptanceTransition, assertOfferTransition } from './offer-state';
import { offerAudit } from './offer-views';
import { offerPayload } from './offer-notifications';

type Tx = Prisma.TransactionClient;

export interface ShiftChange {
  timesOrSkillsChanged: boolean;
  assigneeChanged: boolean;
  newStartAt: Date;
}

/** PENDING -> NOT_SELECTED for every acceptance of the offer; returns the affected rows. */
export async function closePendingRows(
  tx: Tx,
  offerId: string,
): Promise<{ id: string; membershipId: string }[]> {
  const pending = await tx.acceptance.findMany({
    where: { offerId, status: 'PENDING' },
    select: { id: true, status: true, membershipId: true },
  });
  if (pending.length === 0) return [];
  for (const a of pending) assertAcceptanceTransition(a.status, 'NOT_SELECTED');
  await tx.acceptance.updateMany({
    where: { id: { in: pending.map((a) => a.id) }, status: 'PENDING' },
    data: { status: 'NOT_SELECTED' },
  });
  return pending.map((a) => ({ id: a.id, membershipId: a.membershipId }));
}

/** PENDING -> NOT_SELECTED for every acceptance of the offer; returns the affected ids. */
export async function closePending(tx: Tx, offerId: string): Promise<string[]> {
  return (await closePendingRows(tx, offerId)).map((a) => a.id);
}

/** The OPEN offer of a shift (at most one: partial unique index), org-scoped plain read. */
async function openOfferId(tx: Tx, orgId: string, shiftId: string): Promise<string | null> {
  const row = await tx.offer.findFirst({
    where: { organizationId: orgId, shiftId, status: 'OPEN' },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Side effects of shift edits on the shift's OPEN offer (SDD §17). Every method runs inside
 * the caller's shift write transaction. Lock order stays offer -> shift: the caller first calls
 * `lockOpenOfferOf`, then locks the shift, then `assertOpenOfferUnchanged`, then writes.
 */
@Injectable()
export class OfferLifecycle {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Lock the shift's OPEN offer (if any) BEFORE the shift row is locked. Returns its id. */
  async lockOpenOfferOf(tx: Tx, orgId: string, shiftId: string): Promise<string | null> {
    const id = await openOfferId(tx, orgId, shiftId);
    if (id) await lockOffer(tx, orgId, id);
    return id;
  }

  /**
   * After the shift lock: true when no OPEN offer appeared that we did not lock (an offer
   * created between the plain read and the shift lock). The caller retries the transaction
   * when false, so it never touches an offer row it does not hold.
   */
  async openOfferUnchanged(
    tx: Tx,
    orgId: string,
    shiftId: string,
    lockedId: string | null,
  ): Promise<boolean> {
    const current = await openOfferId(tx, orgId, shiftId);
    return current === null || current === lockedId;
  }

  async onShiftChanged(
    tx: Tx,
    orgId: string,
    shiftId: string,
    change: ShiftChange,
    actorMembershipId: string | null = null,
  ): Promise<void> {
    if (!change.assigneeChanged && !change.timesOrSkillsChanged) return;
    const offerId = await openOfferId(tx, orgId, shiftId);
    if (!offerId) return;

    if (change.assigneeChanged) {
      await this.cancel(tx, orgId, offerId, 'SHIFT_REASSIGNED', actorMembershipId);
      return;
    }

    const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { offerLeadTimeMin: true },
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
        data: { status: 'INVALIDATED', invalidatedReason: { code: 'SHIFT_CHANGED' } },
      });
    }
    // The offer stays OPEN; a past-due expiresAt is picked up by lazy expiry / the scheduler.
    const after = await tx.offer.update({
      where: { id: offerId },
      data: {
        expiresAt: new Date(change.newStartAt.getTime() - org.offerLeadTimeMin * 60_000),
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      orgId,
      actorMembershipId,
      action: 'offer.shift_changed',
      entityType: 'offer',
      entityId: offerId,
      before: offerAudit(offer),
      after: offerAudit(after),
      metadata: { invalidatedAcceptanceIds: invalidated },
    });
    if (pending.length > 0) {
      const shift = await tx.shift.findUniqueOrThrow({
        where: { id: shiftId },
        select: { startAt: true, endAt: true },
      });
      await this.notifications.notify(
        tx,
        orgId,
        pending.map((a) => a.membershipId),
        'ACCEPTANCE_INVALIDATED',
        offerPayload(after, shift, 'candidate'),
        actorMembershipId,
      );
    }
  }

  async onShiftDeleted(
    tx: Tx,
    orgId: string,
    shiftId: string,
    actorMembershipId: string | null = null,
  ): Promise<void> {
    const offerId = await openOfferId(tx, orgId, shiftId);
    if (offerId) await this.cancel(tx, orgId, offerId, 'SHIFT_DELETED', actorMembershipId);
  }

  private async cancel(
    tx: Tx,
    orgId: string,
    offerId: string,
    reason: 'SHIFT_REASSIGNED' | 'SHIFT_DELETED',
    actorMembershipId: string | null,
  ): Promise<void> {
    const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
    assertOfferTransition(offer.kind, offer.status, 'CANCELLED');
    const after = await tx.offer.update({
      where: { id: offerId },
      data: {
        status: 'CANCELLED',
        cancelReason: reason,
        resolvedByMembershipId: actorMembershipId,
        resolvedAt: new Date(),
        version: { increment: 1 },
      },
    });
    const notSelected = await closePending(tx, offerId);
    await this.audit.record(tx, {
      orgId,
      actorMembershipId,
      action: 'offer.cancelled',
      entityType: 'offer',
      entityId: offerId,
      before: offerAudit(offer),
      after: offerAudit(after),
      metadata: { notSelectedAcceptanceIds: notSelected },
    });
  }
}
