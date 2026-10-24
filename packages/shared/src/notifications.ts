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
