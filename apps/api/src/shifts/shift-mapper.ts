import type { RuleCode, ShiftDto } from '@shiftswap/shared';
import type { Prisma, Shift } from '../generated/prisma/client';

/** Shift + required skills + id of its OPEN offer (at most one, partial unique index). */
export const SHIFT_INCLUDE = {
  skills: { select: { skillId: true } },
  offers: { where: { status: 'OPEN' as const }, select: { id: true } },
} satisfies Prisma.ShiftInclude;

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
