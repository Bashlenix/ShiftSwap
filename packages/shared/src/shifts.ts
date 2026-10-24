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

function rangeError(startAt: string, endAt: string, maxMs?: number): string | null {
  const diff = Date.parse(endAt) - Date.parse(startAt);
  if (diff <= 0) return 'End must be after start';
  if (maxMs !== undefined && diff > maxMs) return 'A shift can be at most 16 hours';
  return null;
}

function checkRange(v: TimeRange, ctx: z.RefinementCtx, maxMs?: number) {
  if (v.startAt === undefined || v.endAt === undefined) return;
  const message = rangeError(v.startAt, v.endAt, maxMs);
  if (message) ctx.addIssue({ code: 'custom', path: ['endAt'], message });
}

/** Same rule and messages as `createShiftSchema`, for already-merged values (PATCH). */
export function shiftTimesError(startAt: string, endAt: string): string | null {
  return rangeError(startAt, endAt, MAX_SHIFT_MS);
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
    location: shiftFields.location.nullable().optional(),
    notes: shiftFields.notes.nullable().optional(),
    version: z.number().int().min(1),
  })
  .superRefine((v, ctx) => checkRange(v, ctx, MAX_SHIFT_MS));

/** Query of GET /shifts: ISO date-times with offset. */
export const rangeQuerySchema = z.object({ from: isoDate, to: isoDate });

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
