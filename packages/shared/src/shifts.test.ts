import { describe, expect, it } from 'vitest';
import {
  createShiftSchema,
  createUnavailabilitySchema,
  shiftTimesError,
  updateShiftSchema,
} from './shifts';

const base = {
  startAt: '2026-11-02T08:00:00.000Z',
  endAt: '2026-11-02T16:00:00.000Z',
  assignedMembershipId: null,
};

describe('createShiftSchema', () => {
  it('accepts a valid shift and defaults requiredSkillIds', () => {
    const r = createShiftSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.requiredSkillIds).toEqual([]);
  });

  it('rejects end before start', () => {
    const r = createShiftSchema.safeParse({ ...base, endAt: '2026-11-02T07:00:00.000Z' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].path).toEqual(['endAt']);
      expect(r.error.issues[0].message).toBe('End must be after start');
    }
  });

  it('rejects 17 hours', () => {
    const r = createShiftSchema.safeParse({ ...base, endAt: '2026-11-03T01:00:00.000Z' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe('A shift can be at most 16 hours');
  });

  it('accepts an overnight shift 22:00 to 06:00', () => {
    const r = createShiftSchema.safeParse({
      ...base,
      startAt: '2026-11-02T22:00:00.000Z',
      endAt: '2026-11-03T06:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });
});

describe('updateShiftSchema', () => {
  it('requires version', () => {
    expect(updateShiftSchema.safeParse({ location: 'x' }).success).toBe(false);
    expect(updateShiftSchema.safeParse({ location: 'x', version: 1 }).success).toBe(true);
  });

  it('applies refinements when both times are present', () => {
    const r = updateShiftSchema.safeParse({
      version: 1,
      startAt: '2026-11-02T08:00:00.000Z',
      endAt: '2026-11-02T07:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });
});

describe('updateShiftSchema nullable fields', () => {
  it('accepts null to clear location and notes', () => {
    const r = updateShiftSchema.safeParse({ version: 2, location: null, notes: null });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.location).toBeNull();
      expect(r.data.notes).toBeNull();
    }
  });
});

describe('shiftTimesError', () => {
  it('returns the schema messages for merged values', () => {
    expect(shiftTimesError('2026-11-02T08:00:00.000Z', '2026-11-02T08:00:00.000Z')).toBe(
      'End must be after start',
    );
    expect(shiftTimesError('2026-11-02T08:00:00.000Z', '2026-11-03T01:00:00.000Z')).toBe(
      'A shift can be at most 16 hours',
    );
    expect(shiftTimesError('2026-11-02T08:00:00.000Z', '2026-11-02T16:00:00.000Z')).toBeNull();
  });
});

describe('createUnavailabilitySchema', () => {
  it('rejects end not after start', () => {
    const r = createUnavailabilitySchema.safeParse({
      startAt: '2026-11-02T08:00:00.000Z',
      endAt: '2026-11-02T08:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });
});
