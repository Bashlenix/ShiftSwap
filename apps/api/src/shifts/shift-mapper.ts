import type { RuleCode, ShiftDto } from '@shiftswap/shared';
import type { Shift } from '../generated/prisma/client';

export type ShiftRow = Shift & {
  skills: { skillId: string }[];
  offers?: { id: string }[];
};

export function toShiftDto(row: ShiftRow): ShiftDto {
  return {
    id: row.id,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    requiredSkillIds: row.skills.map((s) => s.skillId).sort(),
    assignedMembershipId: row.assignedMembershipId,
    location: row.location,
    notes: row.notes,
    version: row.version,
    openOfferId: row.offers?.[0]?.id ?? null,
  };
}

/** Audit snapshot: IDs and scheduling fields only. */
export function toAuditSnapshot(row: ShiftRow) {
  return {
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    assignedMembershipId: row.assignedMembershipId,
    requiredSkillIds: row.skills.map((s) => s.skillId).sort(),
  };
}

export type Warnings = RuleCode[];
