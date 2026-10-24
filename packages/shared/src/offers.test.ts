import { describe, expect, it } from 'vitest';
import { ERROR_CODES, RULE_LABELS } from './errors';
import { approveOfferSchema, createOfferSchema, versionSchema } from './offers';

const id = '3f2b8c1e-5d4a-4f6b-8a9c-1b2c3d4e5f60';

describe('offer schemas', () => {
  it('accepts valid kinds and rejects TRADE', () => {
    expect(createOfferSchema.safeParse({ shiftId: id, kind: 'GIVE_AWAY' }).success).toBe(true);
    expect(createOfferSchema.safeParse({ shiftId: id, kind: 'OPEN_SHIFT' }).success).toBe(true);
    expect(createOfferSchema.safeParse({ shiftId: id, kind: 'TRADE' }).success).toBe(false);
  });

  it('validates approve and version payloads', () => {
    expect(approveOfferSchema.safeParse({ acceptanceId: id, version: 1 }).success).toBe(true);
    expect(approveOfferSchema.safeParse({ acceptanceId: id, version: 0 }).success).toBe(false);
    expect(versionSchema.safeParse({ version: 2 }).success).toBe(true);
    expect(versionSchema.safeParse({ version: 1.5 }).success).toBe(false);
  });
});

describe('errors', () => {
  it('RULE_LABELS has exactly the 8 rule codes', () => {
    expect(Object.keys(RULE_LABELS).sort()).toEqual([
      'DAILY_LIMIT',
      'IS_OWNER',
      'MIN_REST',
      'MISSING_SKILL',
      'NOT_ACTIVE',
      'OVERLAP',
      'UNAVAILABLE',
      'WEEKLY_LIMIT',
    ]);
  });

  it('ERROR_CODES includes UNAUTHENTICATED and INTERNAL', () => {
    expect(ERROR_CODES).toContain('UNAUTHENTICATED');
    expect(ERROR_CODES).toContain('INTERNAL');
    expect(ERROR_CODES).toContain('SELF_APPROVAL_FORBIDDEN');
  });
});
