import type {
  AcceptanceDto,
  AcceptanceStatus,
  OfferDetailDto,
  OfferSummaryDto,
  RankedAcceptanceDto,
} from '@shiftswap/shared';
import type { Offer, Prisma } from '../generated/prisma/client';
import { SHIFT_INCLUDE, toShiftDto, type ShiftRow } from '../shifts/shift-mapper';

/** Include for summaries: shift (+ open offer id), the caller's own acceptance, pending count. */
export const offerInclude = (callerMembershipId: string) =>
  ({
    shift: { include: SHIFT_INCLUDE },
    acceptances: {
      where: { membershipId: callerMembershipId },
      select: { id: true, membershipId: true, status: true, createdAt: true },
    },
    _count: { select: { acceptances: { where: { status: 'PENDING' } } } },
  }) satisfies Prisma.OfferInclude;

export type OfferRow = Offer & {
  shift: ShiftRow;
  acceptances: { id: string; membershipId: string; status: AcceptanceStatus; createdAt: Date }[];
  _count: { acceptances: number };
};

export function toOfferSummary(row: OfferRow): OfferSummaryDto {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    version: row.version,
    shift: toShiftDto(row.shift),
    originalOwnerMembershipId: row.originalOwnerMembershipId,
    myAcceptanceStatus: row.acceptances[0]?.status ?? null,
    pendingCount: row._count.acceptances,
  };
}

export function toOfferDetail(row: OfferRow, acceptances: RankedAcceptanceDto[]): OfferDetailDto {
  return { ...toOfferSummary(row), acceptances };
}

export function toAcceptanceDto(row: {
  id: string;
  offerId: string;
  membershipId: string;
  status: AcceptanceStatus;
  createdAt: Date;
}): AcceptanceDto {
  return {
    id: row.id,
    offerId: row.offerId,
    membershipId: row.membershipId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Audit snapshot of an offer: IDs, statuses and scheduling fields only. */
export function offerAudit(row: Offer) {
  return {
    kind: row.kind,
    status: row.status,
    shiftId: row.shiftId,
    expiresAt: row.expiresAt.toISOString(),
    originalOwnerMembershipId: row.originalOwnerMembershipId,
    selectedAcceptanceId: row.selectedAcceptanceId,
    cancelReason: row.cancelReason,
    version: row.version,
  };
}
