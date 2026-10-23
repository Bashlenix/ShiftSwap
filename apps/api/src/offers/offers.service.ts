import { Injectable } from '@nestjs/common';
import type {
  CreateOfferInput,
  OfferDetailDto,
  OfferSummaryDto,
  RankedAcceptanceDto,
} from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/domain-error';
import { Prisma } from '../generated/prisma/client';
import { checkEligibility } from '../matching/eligibility';
import { EligibilityLoader } from '../matching/eligibility-loader';
import { rankByScore, scoreCandidate, type ScoreResult } from '../matching/ranking';
import { durationMin } from '../matching/time';
import type { TargetShift } from '../matching/types';
import { PrismaService } from '../prisma/prisma.service';
import { ShiftsService } from '../shifts/shifts.service';
import type { OrgContext } from '../tenancy/org-context.decorator';
import { lockMembership, lockOffer, lockShift } from './offer-locks';
import {
  ACCEPTANCE_INITIAL_STATUS,
  OFFER_INITIAL_STATUS,
  assertAcceptanceTransition,
  assertOfferTransition,
} from './offer-state';
import {
  offerAudit,
  offerInclude,
  toAcceptanceDto,
  toOfferDetail,
  toOfferSummary,
  type AcceptanceDto,
  type OfferRow,
} from './offer-views';

type Tx = Prisma.TransactionClient;
export type OfferScope = 'eligible' | 'mine' | 'review';

const MINE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const notFound = () => new DomainError('NOT_FOUND', 'Not found');
const expired = () => new DomainError('OFFER_EXPIRED', 'The offer has expired');
const isManager = (org: OrgContext) => org.accessLevel !== 'EMPLOYEE';

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loader: EligibilityLoader,
    private readonly shifts: ShiftsService,
  ) {}

  /* ------------------------------------------------------------------ expiry */

  /**
   * Lazy expiry in its own transaction (commits before the caller's write).
   * OPEN and `now >= expiresAt` -> EXPIRED, PENDING acceptances -> NOT_SELECTED.
   * Returns true when this call expired the offer.
   */
  async expireIfDue(orgId: string, offerId: string, now: Date): Promise<boolean> {
    // Cheap unlocked pre-check: most writes hit an offer that is not due.
    const peek = await this.prisma.offer.findFirst({
      where: { id: offerId, organizationId: orgId },
      select: { status: true, expiresAt: true },
    });
    if (!peek || peek.status !== 'OPEN' || now < peek.expiresAt) return false;

    return this.prisma.$transaction(async (tx) => {
      await lockOffer(tx, orgId, offerId);
      const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
      if (offer.status !== 'OPEN' || now < offer.expiresAt) return false;
      assertOfferTransition(offer.kind, offer.status, 'EXPIRED');
      const after = await tx.offer.update({
        where: { id: offerId },
        data: { status: 'EXPIRED', resolvedAt: now, version: { increment: 1 } },
      });
      const notSelected = await this.closePending(tx, offerId);
      await this.audit.record(tx, {
        orgId,
        actorMembershipId: null,
        action: 'offer.expired',
        entityType: 'offer',
        entityId: offerId,
        before: offerAudit(offer),
        after: offerAudit(after),
        metadata: { notSelectedAcceptanceIds: notSelected },
      });
      return true;
    });
  }

  /* ------------------------------------------------------------------ reads */

  async list(org: OrgContext, scope: OfferScope): Promise<OfferSummaryDto[]> {
    const now = new Date();
    const include = offerInclude(org.membershipId);
    const orderBy = [{ shift: { startAt: 'asc' as const } }, { id: 'asc' as const }];

    if (scope === 'mine') {
      const rows = await this.prisma.offer.findMany({
        where: {
          organizationId: org.orgId,
          createdAt: { gte: new Date(now.getTime() - MINE_WINDOW_MS) },
          OR: [
            { originalOwnerMembershipId: org.membershipId },
            { acceptances: { some: { membershipId: org.membershipId } } },
          ],
        },
        include,
        orderBy,
      });
      return rows.map(toOfferSummary);
    }

    if (scope === 'review') {
      if (!isManager(org)) throw new DomainError('FORBIDDEN', 'Insufficient access level');
      const rows = await this.prisma.offer.findMany({
        where: {
          organizationId: org.orgId,
          kind: 'GIVE_AWAY',
          status: 'OPEN',
          expiresAt: { gt: now },
          shift: { deletedAt: null },
        },
        include,
        orderBy,
      });
      return rows.map(toOfferSummary);
    }

    // eligible: OPEN offers on shifts the caller does not hold, passing the hard rules now.
    const rows = await this.prisma.offer.findMany({
      where: {
        organizationId: org.orgId,
        status: 'OPEN',
        expiresAt: { gt: now },
        shift: {
          deletedAt: null,
          OR: [{ assignedMembershipId: null }, { assignedMembershipId: { not: org.membershipId } }],
        },
      },
      include,
      orderBy,
    });
    // One loader call (4 queries) per offer: the loader's week window is per target shift.
    // Acceptable for the expected handful (<= ~20) of open offers per org.
    const checks = await Promise.all(
      rows.map(async (row) => {
        const target = EligibilityLoader.toTargetShift(row.shift);
        const loaded = await this.loader.load(this.prisma, org, target, [org.membershipId]);
        const entry = loaded.get(org.membershipId);
        return entry ? checkEligibility(entry.ctx, target).eligible : false;
      }),
    );
    return rows.filter((_, i) => checks[i]).map(toOfferSummary);
  }

  async detail(org: OrgContext, offerId: string): Promise<OfferDetailDto> {
    const row = await this.findOffer(this.prisma, org, offerId);
    const target = EligibilityLoader.toTargetShift(row.shift);

    if (!isManager(org)) {
      const own = row.acceptances[0];
      if (row.originalOwnerMembershipId !== org.membershipId && !own) throw notFound();
      if (!own) return toOfferDetail(row, []);
      const me = await this.prisma.membership.findFirstOrThrow({
        where: { id: org.membershipId, organizationId: org.orgId },
        select: { displayName: true },
      });
      const [ranked] = await this.rank(org, target, [{ ...own, displayName: me.displayName }]);
      // Employees never see scores, only whether they would still pass the rules.
      return toOfferDetail(row, [{ ...ranked, score: null }]);
    }

    const all = await this.prisma.acceptance.findMany({
      where: { offerId, organizationId: org.orgId },
      select: {
        id: true,
        membershipId: true,
        status: true,
        createdAt: true,
        membership: { select: { displayName: true } },
      },
    });
    const acceptances = await this.rank(
      org,
      target,
      all.map((a) => ({ ...a, displayName: a.membership.displayName })),
    );
    return toOfferDetail(row, acceptances);
  }

  /* ------------------------------------------------------------------ writes */

  async create(org: OrgContext, input: CreateOfferInput): Promise<OfferSummaryDto> {
    if (input.kind === 'OPEN_SHIFT' && !isManager(org)) {
      throw new DomainError('FORBIDDEN', 'Only managers can post open shifts');
    }
    const now = new Date();
    const id = await this.prisma.$transaction(async (tx) => {
      await lockShift(tx, org.orgId, input.shiftId);
      const shift = await this.shifts.findInOrg(org.orgId, input.shiftId, tx);

      if (input.kind === 'GIVE_AWAY' && shift.assignedMembershipId !== org.membershipId) {
        throw new DomainError('FORBIDDEN', 'You can only give away your own shifts');
      }
      if (input.kind === 'OPEN_SHIFT' && shift.assignedMembershipId !== null) {
        throw new DomainError('INVALID_TRANSITION', 'Only unassigned shifts can be posted');
      }
      const expiresAt = new Date(shift.startAt.getTime() - org.leadTimeMin * 60_000);
      if (now >= expiresAt) throw expired();
      // Fast path; the partial unique index offers_one_open_per_shift is the real guard.
      if ((shift.offers?.length ?? 0) > 0) {
        throw new DomainError('OFFER_ALREADY_OPEN', 'This shift already has an open offer');
      }

      const offer = await tx.offer.create({
        data: {
          organizationId: org.orgId,
          shiftId: shift.id,
          kind: input.kind,
          status: OFFER_INITIAL_STATUS,
          originalOwnerMembershipId: input.kind === 'GIVE_AWAY' ? org.membershipId : null,
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
      });
      return offer.id;
    });
    return toOfferSummary(await this.findOffer(this.prisma, org, id));
  }

  /** Accept a give-away. `created` tells the controller 201 vs 200. */
  async accept(
    org: OrgContext,
    offerId: string,
  ): Promise<{ acceptance: AcceptanceDto; created: boolean }> {
    const now = new Date();
    if (await this.expireIfDue(org.orgId, offerId, now)) throw expired();

    return this.prisma.$transaction(async (tx) => {
      const offer = await this.lockOpenOffer(tx, org.orgId, offerId, now);
      if (offer.kind !== 'GIVE_AWAY') {
        throw new DomainError('INVALID_TRANSITION', 'Open shifts are claimed, not accepted');
      }
      await this.lockAndCheckCandidate(tx, org, offer.shiftId);

      const existing = await tx.acceptance.findUnique({
        where: { offerId_membershipId: { offerId, membershipId: org.membershipId } },
      });
      if (existing?.status === 'PENDING') {
        return { acceptance: toAcceptanceDto(existing), created: false };
      }
      if (existing) {
        assertAcceptanceTransition(existing.status, 'PENDING');
        const updated = await tx.acceptance.update({
          where: { id: existing.id },
          data: { status: 'PENDING', invalidatedReason: Prisma.DbNull },
        });
        await this.audit.record(tx, {
          orgId: org.orgId,
          actorMembershipId: org.membershipId,
          action: 'acceptance.reactivated',
          entityType: 'acceptance',
          entityId: existing.id,
          before: { offerId, status: existing.status },
          after: { offerId, status: updated.status },
        });
        return { acceptance: toAcceptanceDto(updated), created: false };
      }
      const created = await tx.acceptance.create({
        data: {
          organizationId: org.orgId,
          offerId,
          membershipId: org.membershipId,
          status: ACCEPTANCE_INITIAL_STATUS.GIVE_AWAY,
        },
      });
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'acceptance.created',
        entityType: 'acceptance',
        entityId: created.id,
        after: { offerId, membershipId: org.membershipId, status: created.status },
      });
      return { acceptance: toAcceptanceDto(created), created: true };
    });
  }

  async withdraw(org: OrgContext, offerId: string): Promise<void> {
    const now = new Date();
    if (await this.expireIfDue(org.orgId, offerId, now)) throw expired();

    await this.prisma.$transaction(async (tx) => {
      await this.lockOpenOffer(tx, org.orgId, offerId, now);
      const acceptance = await tx.acceptance.findUnique({
        where: { offerId_membershipId: { offerId, membershipId: org.membershipId } },
      });
      if (!acceptance) throw notFound();
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
      });
    });
  }

  /** First eligible claim wins (SDD §25): the offer row lock serializes claimants. */
  async claim(org: OrgContext, offerId: string): Promise<OfferSummaryDto> {
    const now = new Date();
    if (await this.expireIfDue(org.orgId, offerId, now)) throw expired();

    await this.prisma.$transaction(async (tx) => {
      await lockOffer(tx, org.orgId, offerId);
      const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
      if (offer.kind !== 'OPEN_SHIFT') {
        throw new DomainError('INVALID_TRANSITION', 'Give-aways are accepted, not claimed');
      }
      if (offer.status !== 'OPEN') {
        throw new DomainError('OFFER_ALREADY_FILLED', 'This shift has already been taken');
      }
      if (now >= offer.expiresAt) throw expired();

      const shift = await this.lockAndCheckCandidate(tx, org, offer.shiftId);
      if (shift.assignedMembershipId !== null) {
        throw new DomainError('OFFER_ALREADY_FILLED', 'This shift has already been taken');
      }

      assertOfferTransition(offer.kind, offer.status, 'FILLED');
      const { count } = await tx.shift.updateMany({
        where: { id: shift.id, organizationId: org.orgId, version: shift.version },
        data: { assignedMembershipId: org.membershipId, version: { increment: 1 } },
      });
      if (count === 0) {
        // Unreachable while the shift row is locked; keep the write conditional anyway.
        throw new DomainError('VERSION_CONFLICT', 'The shift was changed by someone else');
      }
      const acceptance = await tx.acceptance.create({
        data: {
          organizationId: org.orgId,
          offerId,
          membershipId: org.membershipId,
          status: ACCEPTANCE_INITIAL_STATUS.OPEN_SHIFT,
        },
      });
      const after = await tx.offer.update({
        where: { id: offerId },
        data: {
          status: 'FILLED',
          selectedAcceptanceId: acceptance.id,
          resolvedByMembershipId: org.membershipId,
          resolvedAt: now,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'offer.filled',
        entityType: 'offer',
        entityId: offerId,
        before: { ...offerAudit(offer), assignedMembershipId: null },
        after: { ...offerAudit(after), assignedMembershipId: org.membershipId },
        metadata: { acceptanceId: acceptance.id, acceptanceStatus: acceptance.status },
      });
    });
    return toOfferSummary(await this.findOffer(this.prisma, org, offerId));
  }

  async cancel(org: OrgContext, offerId: string, version: number): Promise<OfferSummaryDto> {
    const now = new Date();
    if (await this.expireIfDue(org.orgId, offerId, now)) throw expired();

    await this.prisma.$transaction(async (tx) => {
      await lockOffer(tx, org.orgId, offerId);
      const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });

      const isOwner =
        offer.kind === 'GIVE_AWAY' && offer.originalOwnerMembershipId === org.membershipId;
      if (!isOwner && !isManager(org)) {
        throw new DomainError('FORBIDDEN', 'You cannot cancel this offer');
      }
      if (offer.version !== version) {
        throw new DomainError('VERSION_CONFLICT', 'The offer was changed by someone else', {
          currentVersion: offer.version,
        });
      }
      assertOfferTransition(offer.kind, offer.status, 'CANCELLED');
      if (now >= offer.expiresAt) throw expired();

      const after = await tx.offer.update({
        where: { id: offerId },
        data: {
          status: 'CANCELLED',
          cancelReason: isOwner ? 'WITHDRAWN' : 'MANAGER',
          resolvedByMembershipId: org.membershipId,
          resolvedAt: now,
          version: { increment: 1 },
        },
      });
      const notSelected = await this.closePending(tx, offerId);
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'offer.cancelled',
        entityType: 'offer',
        entityId: offerId,
        before: offerAudit(offer),
        after: offerAudit(after),
        metadata: { notSelectedAcceptanceIds: notSelected },
      });
    });
    return toOfferSummary(await this.findOffer(this.prisma, org, offerId));
  }

  /* ------------------------------------------------------------------ helpers */

  private async findOffer(db: Tx | PrismaService, org: OrgContext, offerId: string) {
    const row = await db.offer.findFirst({
      where: { id: offerId, organizationId: org.orgId },
      include: offerInclude(org.membershipId),
    });
    if (!row) throw notFound();
    return row as OfferRow;
  }

  /** Lock the offer and require it to still be OPEN and not due (re-checked under the lock). */
  private async lockOpenOffer(tx: Tx, orgId: string, offerId: string, now: Date) {
    await lockOffer(tx, orgId, offerId);
    const offer = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
    if (offer.status !== 'OPEN') {
      throw new DomainError('INVALID_TRANSITION', `The offer is ${offer.status.toLowerCase()}`);
    }
    if (now >= offer.expiresAt) throw expired();
    return offer;
  }

  /**
   * Lock shift -> caller membership (after the offer lock), then run the hard rules for the
   * caller against the shift as it is now. Throws 422 INELIGIBLE with failedRules.
   */
  private async lockAndCheckCandidate(tx: Tx, org: OrgContext, shiftId: string) {
    await lockShift(tx, org.orgId, shiftId);
    const shift = await this.shifts.findInOrg(org.orgId, shiftId, tx);
    await lockMembership(tx, org.orgId, org.membershipId);
    const target = EligibilityLoader.toTargetShift(shift);
    const loaded = await this.loader.load(tx, org, target, [org.membershipId]);
    const entry = loaded.get(org.membershipId);
    const result = entry
      ? checkEligibility(entry.ctx, target)
      : { eligible: false, failedRules: ['NOT_ACTIVE' as const] };
    if (!result.eligible) {
      throw new DomainError('INELIGIBLE', 'You cannot take this shift', {
        failedRules: result.failedRules,
      });
    }
    return shift;
  }

  /** PENDING -> NOT_SELECTED for every acceptance of the offer; returns the affected ids. */
  private async closePending(tx: Tx, offerId: string): Promise<string[]> {
    const pending = await tx.acceptance.findMany({
      where: { offerId, status: 'PENDING' },
      select: { id: true, status: true },
    });
    if (pending.length === 0) return [];
    for (const a of pending) assertAcceptanceTransition(a.status, 'NOT_SELECTED');
    const ids = pending.map((a) => a.id);
    await tx.acceptance.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'NOT_SELECTED' },
    });
    return ids;
  }

  /** Live re-check + score per acceptance (one loader call), ranked by rankByScore. */
  private async rank(
    org: OrgContext,
    target: TargetShift,
    acceptances: {
      id: string;
      membershipId: string;
      displayName: string;
      status: RankedAcceptanceDto['status'];
      createdAt: Date;
    }[],
  ): Promise<RankedAcceptanceDto[]> {
    if (acceptances.length === 0) return [];
    const loaded = await this.loader.load(
      this.prisma,
      org,
      target,
      acceptances.map((a) => a.membershipId),
    );
    const shiftMin = durationMin(target);
    const items = acceptances.map((a) => {
      const entry = loaded.get(a.membershipId);
      const recheck = entry
        ? checkEligibility(entry.ctx, target)
        : { eligible: false, failedRules: ['NOT_ACTIVE' as const] };
      const score: ScoreResult | null =
        entry && recheck.eligible
          ? scoreCandidate({
              preference: 'NEUTRAL',
              weeklyMinutesAfter: entry.weeklyMinutes + shiftMin,
              weeklyLimitMin:
                entry.ctx.candidate.weeklyLimitMin ?? org.policy.defaultWeeklyLimitMin,
              swapsLast30Days: entry.swapsLast30Days,
            })
          : null;
      return { ...a, score, recheck };
    });
    return rankByScore(items).map((a) => ({
      id: a.id,
      membershipId: a.membershipId,
      displayName: a.displayName,
      status: a.status,
      createdAt: a.createdAt.toISOString(),
      score: a.score,
      recheck: { eligible: a.recheck.eligible, failedRules: [...a.recheck.failedRules] },
    }));
  }
}
