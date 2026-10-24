import type { NotificationDto } from '@shiftswap/shared';
import { formatShiftTime } from '../../lib/format';

const FALLBACK = 'You have a new notification.';

/** Plain-English text for a notification; never throws, unknown shapes get the fallback. */
export function notificationText(n: NotificationDto, timezone: string): string {
  const { shiftStartAt, shiftEndAt, role, reason } = n.payload ?? {};
  if (n.type === 'MEMBER_DEACTIVATED')
    return 'A member was deactivated; their shifts were reposted.';
  if (!shiftStartAt || !shiftEndAt) return FALLBACK;
  let time: string;
  try {
    time = formatShiftTime(shiftStartAt, shiftEndAt, timezone);
  } catch {
    return FALLBACK;
  }
  switch (n.type) {
    case 'OFFER_CREATED':
      if (role === 'eligible') return `New shift available: ${time}.`;
      if (role === 'manager') return `A shift was offered: ${time}.`;
      return FALLBACK;
    case 'ACCEPTANCE_RECEIVED':
      return `Someone accepted the offer for ${time}.`;
    case 'OFFER_APPROVED':
      if (role === 'selected') return `You got the shift ${time}.`;
      if (role === 'owner') return `Your offer for ${time} was approved.`;
      if (role === 'notSelected') return `The shift ${time} went to someone else.`;
      return FALLBACK;
    case 'OFFER_REJECTED':
      return `The offer for ${time} was rejected.`;
    case 'OFFER_EXPIRED':
      return `The offer for ${time} expired.`;
    case 'ACCEPTANCE_INVALIDATED':
      // The give-away was cancelled (SDD §17); its shift may have been reposted as open.
      if (reason === 'OWNER_DEACTIVATED')
        return `The offer for ${time} was cancelled — check open shifts if you still want it.`;
      return `The shift ${time} changed — accept again if you still want it.`;
    case 'OPEN_SHIFT_FILLED':
      if (role === 'selected') return `You claimed the shift ${time}.`;
      if (role === 'manager') return `The open shift ${time} was filled.`;
      return FALLBACK;
    default:
      return FALLBACK;
  }
}
