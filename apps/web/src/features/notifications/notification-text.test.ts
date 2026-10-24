import type { NotificationDto, NotificationType } from '@shiftswap/shared';
import { describe, expect, it } from 'vitest';
import { notificationText } from './notification-text';

const T = 'Sat 24 Oct, 10:00–18:00';
const n = (type: NotificationType, role?: string): NotificationDto => ({
  id: 'n1',
  type,
  readAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  payload: {
    shiftStartAt: '2026-10-24T08:00:00Z',
    shiftEndAt: '2026-10-24T16:00:00Z',
    ...(role ? { role: role as never } : {}),
  },
});
const text = (type: NotificationType, role?: string) =>
  notificationText(n(type, role), 'Europe/Berlin');

describe('notificationText', () => {
  it.each([
    ['OFFER_CREATED', 'eligible', `New shift available: ${T}.`],
    ['OFFER_CREATED', 'manager', `A shift was offered: ${T}.`],
    ['ACCEPTANCE_RECEIVED', 'owner', `Someone accepted the offer for ${T}.`],
    ['ACCEPTANCE_RECEIVED', 'manager', `Someone accepted the offer for ${T}.`],
    ['OFFER_APPROVED', 'selected', `You got the shift ${T}.`],
    ['OFFER_APPROVED', 'owner', `Your offer for ${T} was approved.`],
    ['OFFER_APPROVED', 'notSelected', `The shift ${T} went to someone else.`],
    ['OFFER_REJECTED', 'owner', `The offer for ${T} was rejected.`],
    ['OFFER_REJECTED', 'candidate', `The offer for ${T} was rejected.`],
    ['OFFER_EXPIRED', 'owner', `The offer for ${T} expired.`],
    ['OFFER_EXPIRED', 'manager', `The offer for ${T} expired.`],
    [
      'ACCEPTANCE_INVALIDATED',
      'candidate',
      `The shift ${T} changed — accept again if you still want it.`,
    ],
    ['OPEN_SHIFT_FILLED', 'selected', `You claimed the shift ${T}.`],
    ['OPEN_SHIFT_FILLED', 'manager', `The open shift ${T} was filled.`],
    ['MEMBER_DEACTIVATED', 'manager', 'A member was deactivated; their shifts were reposted.'],
  ] as const)('%s / %s', (type, role, expected) => {
    expect(text(type, role)).toBe(expected);
  });

  it('never crashes on unknown combinations or missing times', () => {
    expect(text('OFFER_CREATED', 'owner')).toBe('You have a new notification.');
    expect(text('OFFER_APPROVED')).toBe('You have a new notification.');
    expect(text('SOMETHING_NEW' as NotificationType, 'x')).toBe('You have a new notification.');
    expect(
      notificationText({ ...n('OFFER_EXPIRED', 'owner'), payload: { role: 'owner' } }, 'UTC'),
    ).toBe('You have a new notification.');
  });
});
