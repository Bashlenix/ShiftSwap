import { describe, expect, it } from 'vitest';
import { PREFERENCE_SLOTS, preferenceGridSchema } from './preferences';

const full = () =>
  Array.from({ length: 7 }, (_, weekday) =>
    PREFERENCE_SLOTS.map((slot) => ({ weekday, slot, value: 'PREFERRED' as const })),
  ).flat();

describe('preferenceGridSchema', () => {
  it('accepts an empty grid and a full 21-entry grid', () => {
    expect(preferenceGridSchema.safeParse({ entries: [] }).success).toBe(true);
    expect(preferenceGridSchema.safeParse({ entries: full() }).success).toBe(true);
  });

  it('rejects a duplicate (weekday, slot) at path entries', () => {
    const r = preferenceGridSchema.safeParse({
      entries: [
        { weekday: 1, slot: 'MORNING', value: 'AVOID' },
        { weekday: 1, slot: 'MORNING', value: 'PREFERRED' },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path.join('.') === 'entries')).toBe(true);
  });

  it.each([
    ['weekday 7', { weekday: 7, slot: 'MORNING', value: 'AVOID' }],
    ['weekday 1.5', { weekday: 1.5, slot: 'MORNING', value: 'AVOID' }],
    ['value NEUTRAL', { weekday: 1, slot: 'MORNING', value: 'NEUTRAL' }],
    ['unknown key', { weekday: 1, slot: 'MORNING', value: 'AVOID', extra: 1 }],
  ])('rejects %s', (_n, entry) => {
    expect(preferenceGridSchema.safeParse({ entries: [entry] }).success).toBe(false);
  });

  it('rejects 22 entries', () => {
    const entries = [...full(), { weekday: 0, slot: 'MORNING', value: 'AVOID' }];
    expect(preferenceGridSchema.safeParse({ entries }).success).toBe(false);
  });
});
