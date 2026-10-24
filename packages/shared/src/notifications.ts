import type { OfferKind } from './offers';

export const NOTIFICATION_TYPES = [
  'OFFER_CREATED',
  'ACCEPTANCE_RECEIVED',
  'OFFER_APPROVED',
  'OFFER_REJECTED',
  'OFFER_EXPIRED',
  'ACCEPTANCE_INVALIDATED',
  'OPEN_SHIFT_FILLED',
  'MEMBER_DEACTIVATED',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** IDs, scheduling fields, kind and role only: no names or free text. */
export interface NotificationPayload {
  offerId?: string;
  shiftId?: string;
  shiftStartAt?: string;
  shiftEndAt?: string;
  kind?: OfferKind;
  role?: 'owner' | 'candidate' | 'selected' | 'notSelected' | 'manager' | 'eligible';
  /** Why an ACCEPTANCE_INVALIDATED happened when the offer itself is gone (a code, not text). */
  reason?: 'OWNER_DEACTIVATED';
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
}

/** Types that are also emailed; MEMBER_DEACTIVATED stays in-app only. */
export const EMAIL_NOTIFICATION_TYPES: readonly NotificationType[] = NOTIFICATION_TYPES.filter(
  (t) => t !== 'MEMBER_DEACTIVATED',
);

/** App path (no origin) a notification should open. */
export function notificationPath(
  orgId: string,
  n: Pick<NotificationDto, 'type' | 'payload'>,
): string {
  const base = `/orgs/${orgId}`;
  if (n.payload?.role === 'manager')
    return n.payload.offerId ? `${base}/review/${n.payload.offerId}` : `${base}/review`;
  switch (n.type) {
    case 'OFFER_CREATED':
    case 'ACCEPTANCE_INVALIDATED':
      return `${base}/offers`;
    case 'OFFER_APPROVED':
    case 'OFFER_REJECTED':
    case 'OFFER_EXPIRED':
    case 'ACCEPTANCE_RECEIVED':
    case 'OPEN_SHIFT_FILLED':
      return `${base}/me/shifts`;
    default:
      return `${base}/notifications`;
  }
}
