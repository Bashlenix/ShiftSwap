import { z } from 'zod';

export const PREFERENCE_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export const PREFERENCE_VALUES = ['PREFERRED', 'AVOID'] as const;

export type PreferenceSlot = (typeof PREFERENCE_SLOTS)[number];
export type PreferenceValue = (typeof PREFERENCE_VALUES)[number];

export interface PreferenceEntry {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  slot: PreferenceSlot;
  value: PreferenceValue;
}

export interface PreferenceGridDto {
  entries: PreferenceEntry[];
}

const entry = z
  .object({
    weekday: z.number().int().min(0).max(6),
    slot: z.enum(PREFERENCE_SLOTS),
    value: z.enum(PREFERENCE_VALUES),
  })
  .strict();

export const preferenceGridSchema = z
  .object({ entries: z.array(entry).max(21) })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const e of v.entries) {
      const key = `${e.weekday}:${e.slot}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries'],
          message: 'Each day and time slot can appear only once',
        });
        return;
      }
      seen.add(key);
    }
  });
