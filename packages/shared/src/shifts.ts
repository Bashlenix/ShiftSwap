import { z } from 'zod';
import type { RuleCode } from './errors';

const MAX_SHIFT_MS = 16 * 60 * 60 * 1000;

const isoDate = z.iso.datetime({ offset: true });

const shiftFields = {
  startAt: isoDate,
  endAt: isoDate,
  requiredSkillIds: z.array(z.uuid()).default([]),
  assignedMembershipId: z.uuid().nullable(),
  location: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
};

type TimeRange = { startAt?: string; endAt?: string };

function checkRange(v: TimeRange, ctx: z.RefinementCtx, maxMs?: number) {
  if (v.startAt === undefined || v.endAt === undefined) return;
  const diff = Date.parse(v.endAt) - Date.parse(v.startAt);
  if (diff <= 0) {
    ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'End must be after start' });
  } else if (maxMs !== undefined && diff > maxMs) {
    ctx.addIssue({ code: 'custom', path: ['endAt'], message: 'A shift can be at most 16 hours' });
  }
}

export const createShiftSchema = z
  .object(shiftFields)
  .superRefine((v, ctx) => checkRange(v, ctx, MAX_SHIFT_MS));

export const updateShiftSchema = z
  .object({
    startAt: shiftFields.startAt.optional(),
    endAt: shiftFields.endAt.optional(),
    requiredSkillIds: z.array(z.uuid()).optional(),
    assignedMembershipId: z.uuid().nullable().optional(),
    location: shiftFields.location,
    notes: shiftFields.notes,
    version: z.number().int().min(1),
  })
  .superRefine((v, ctx) => checkRange(v, ctx, MAX_SHIFT_MS));

export const createUnavailabilitySchema = z
  .object({ startAt: isoDate, endAt: isoDate })
  .superRefine((v, ctx) => checkRange(v, ctx));

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type CreateUnavailabilityInput = z.infer<typeof createUnavailabilitySchema>;

export interface ShiftDto {
  id: string;
  startAt: string;
  endAt: string;
  requiredSkillIds: string[];
  assignedMembershipId: string | null;
  location: string | null;
  notes: string | null;
  version: number;
  openOfferId: string | null;
}

export interface ShiftWriteResponse {
  shift: ShiftDto;
  warnings: RuleCode[];
}
