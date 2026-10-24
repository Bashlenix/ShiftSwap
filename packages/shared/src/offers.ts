import { z } from 'zod';
import type { RuleCode } from './errors';
import type { ShiftDto } from './shifts';

export type OfferKind = 'GIVE_AWAY' | 'OPEN_SHIFT';
export type OfferStatus = 'OPEN' | 'APPROVED' | 'REJECTED' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
export type AcceptanceStatus =
  'PENDING' | 'SELECTED' | 'NOT_SELECTED' | 'WITHDRAWN' | 'INVALIDATED';
export type AccessLevel = 'EMPLOYEE' | 'MANAGER' | 'ADMIN';

export const createOfferSchema = z.object({
  shiftId: z.uuid(),
  kind: z.enum(['GIVE_AWAY', 'OPEN_SHIFT']),
});

export const approveOfferSchema = z.object({
  acceptanceId: z.uuid(),
  version: z.number().int().min(1),
});

export const versionSchema = z.object({ version: z.number().int().min(1) });

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type ApproveOfferInput = z.infer<typeof approveOfferSchema>;
export type VersionInput = z.infer<typeof versionSchema>;

export interface OfferSummaryDto {
  id: string;
  kind: OfferKind;
  status: OfferStatus;
  expiresAt: string;
  version: number;
  shift: ShiftDto;
  originalOwnerMembershipId: string | null;
  myAcceptanceStatus: AcceptanceStatus | null;
  pendingCount: number;
}

export interface RankedAcceptanceDto {
  id: string;
  membershipId: string;
  displayName: string;
  status: AcceptanceStatus;
  createdAt: string;
  score: {
    total: number;
    breakdown: { preference: number; headroom: number; swapLoad: number };
  } | null;
  recheck: { eligible: boolean; failedRules: RuleCode[] };
}

export type OfferDetailDto = OfferSummaryDto & { acceptances: RankedAcceptanceDto[] };

export interface MemberDto {
  id: string;
  displayName: string;
  accessLevel: AccessLevel;
  email: string | null;
  status: 'ACTIVE' | 'DEACTIVATED';
  hasLogin: boolean;
  invitePending: boolean;
  skillIds: string[];
  weeklyLimitMin: number | null;
}

export interface CreateMemberResponse {
  member: MemberDto;
  inviteLink: string | null;
}

export interface SkillDto {
  id: string;
  name: string;
}
