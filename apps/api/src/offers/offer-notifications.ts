import type { NotificationPayload } from '@shiftswap/shared';

/** The only fields a swap notification carries: IDs, scheduling fields, kind and role. */
export function offerPayload(
  offer: { id: string; kind: 'GIVE_AWAY' | 'OPEN_SHIFT'; shiftId: string },
  shift: { startAt: Date; endAt: Date },
  role?: NotificationPayload['role'],
): NotificationPayload {
  return {
    offerId: offer.id,
    shiftId: offer.shiftId,
    shiftStartAt: shift.startAt.toISOString(),
    shiftEndAt: shift.endAt.toISOString(),
    kind: offer.kind,
    ...(role ? { role } : {}),
  };
}
