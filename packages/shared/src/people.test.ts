import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './errors';
import {
  createMemberSchema,
  createOrgSchema,
  isValidTimeZone,
  orgSettingsSchema,
  resendInviteSchema,
  skillSchema,
  updateMemberSchema,
} from './people';

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects others', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('createOrgSchema', () => {
  it('trims name and defaults timezone', () => {
    expect(createOrgSchema.parse({ name: '  Cafe  ' })).toEqual({
      name: 'Cafe',
      timezone: 'Europe/Berlin',
    });
  });
  it('rejects empty name and bad zone', () => {
    expect(createOrgSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createOrgSchema.safeParse({ name: 'A', timezone: 'Mars/Olympus' }).success).toBe(false);
  });
});

describe('orgSettingsSchema', () => {
  it('requires at least one field', () => {
    const r = orgSettingsSchema.safeParse({});
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Change at least one setting');
  });
  it('enforces ranges', () => {
    expect(orgSettingsSchema.safeParse({ offerLeadTimeMin: 2881 }).success).toBe(false);
    expect(orgSettingsSchema.safeParse({ offerLeadTimeMin: 2880 }).success).toBe(true);
    expect(orgSettingsSchema.safeParse({ minRestMin: 1441 }).success).toBe(false);
    expect(orgSettingsSchema.safeParse({ maxDailyMin: 59 }).success).toBe(false);
    expect(orgSettingsSchema.safeParse({ defaultWeeklyLimitMin: 4801 }).success).toBe(false);
  });
});

describe('createMemberSchema', () => {
  it('lowercases email and applies defaults', () => {
    const r = createMemberSchema.parse({ displayName: 'Ann', email: 'Ann@Example.COM' });
    expect(r.email).toBe('ann@example.com');
    expect(r.accessLevel).toBe('EMPLOYEE');
    expect(r.skillIds).toEqual([]);
  });
  it('accepts null email and rejects bad input', () => {
    expect(createMemberSchema.safeParse({ displayName: 'Ann', email: null }).success).toBe(true);
    expect(createMemberSchema.safeParse({ displayName: 'Ann', email: 'nope' }).success).toBe(false);
    expect(createMemberSchema.safeParse({ displayName: '' }).success).toBe(false);
    expect(createMemberSchema.safeParse({ displayName: 'A', appOrigin: 'x' }).success).toBe(false);
    expect(createMemberSchema.safeParse({ displayName: 'A', weeklyLimitMin: 59 }).success).toBe(
      false,
    );
  });
});

describe('updateMemberSchema / resendInviteSchema / skillSchema', () => {
  it('update needs at least one field and allows null limit', () => {
    expect(updateMemberSchema.safeParse({}).success).toBe(false);
    expect(updateMemberSchema.safeParse({ weeklyLimitMin: null }).success).toBe(true);
  });
  it('resend accepts empty and url', () => {
    expect(resendInviteSchema.safeParse({}).success).toBe(true);
    expect(resendInviteSchema.safeParse({ appOrigin: 'https://a.test' }).success).toBe(true);
  });
  it('skill trims and bounds', () => {
    expect(skillSchema.parse({ name: ' Bar ' }).name).toBe('Bar');
    expect(skillSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
  });
});

describe('new error codes', () => {
  it('are registered', () => {
    for (const c of [
      'LAST_ADMIN',
      'ALREADY_MEMBER',
      'INVITE_INVALID',
      'SKILL_IN_USE',
      'EMAIL_MISMATCH',
    ]) {
      expect(ERROR_CODES).toContain(c);
    }
  });
});
