import { describe, expect, it } from 'vitest';
import { EMAIL_NOTIFICATION_TYPES, NOTIFICATION_TYPES, notificationPath } from './notifications';

describe('NOTIFICATION_TYPES', () => {
  it('matches the database enum', () => {
    expect([...NOTIFICATION_TYPES]).toEqual([
      'OFFER_CREATED',
      'ACCEPTANCE_RECEIVED',
      'OFFER_APPROVED',
      'OFFER_REJECTED',
      'OFFER_EXPIRED',
      'ACCEPTANCE_INVALIDATED',
      'OPEN_SHIFT_FILLED',
      'MEMBER_DEACTIVATED',
    ]);
  });
});

describe('EMAIL_NOTIFICATION_TYPES', () => {
  it('is every type except MEMBER_DEACTIVATED', () => {
    expect(EMAIL_NOTIFICATION_TYPES).toHaveLength(7);
    expect(EMAIL_NOTIFICATION_TYPES).not.toContain('MEMBER_DEACTIVATED');
  });
});

describe('notificationPath', () => {
  it('sends managers to the review page of the offer', () => {
    expect(
      notificationPath('o1', {
        type: 'OFFER_CREATED',
        payload: { role: 'manager', offerId: 'f1' },
      }),
    ).toBe('/orgs/o1/review/f1');
  });
  it('sends managers to the review list without an offer id', () => {
    expect(
      notificationPath('o1', { type: 'OPEN_SHIFT_FILLED', payload: { role: 'manager' } }),
    ).toBe('/orgs/o1/review');
  });
  it.each(['OFFER_CREATED', 'ACCEPTANCE_INVALIDATED'] as const)('%s goes to offers', (type) => {
    expect(notificationPath('o1', { type, payload: { role: 'eligible' } })).toBe('/orgs/o1/offers');
  });
  it.each([
    'OFFER_APPROVED',
    'OFFER_REJECTED',
    'OFFER_EXPIRED',
    'ACCEPTANCE_RECEIVED',
    'OPEN_SHIFT_FILLED',
  ] as const)('%s goes to my shifts', (type) => {
    expect(notificationPath('o1', { type, payload: { role: 'selected' } })).toBe(
      '/orgs/o1/me/shifts',
    );
  });
  it('falls back to the notifications page', () => {
    expect(notificationPath('o1', { type: 'MEMBER_DEACTIVATED', payload: {} })).toBe(
      '/orgs/o1/notifications',
    );
  });
});
