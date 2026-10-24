import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from './notifications';

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
