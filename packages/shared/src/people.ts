import { z } from 'zod';

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timezone = z.string().refine(isValidTimeZone, 'Enter a valid time zone, e.g. Europe/Berlin');
const orgName = z.string().trim().min(1, 'Enter a name').max(80, 'Use at most 80 characters');
const displayName = z.string().trim().min(1, 'Enter a name').max(80, 'Use at most 80 characters');
const weeklyLimit = z.number().int().min(60).max(4800);
const accessLevel = z.enum(['EMPLOYEE', 'MANAGER', 'ADMIN']);
const appOrigin = z.string().url();

export const createOrgSchema = z.object({
  name: orgName,
  timezone: timezone.default('Europe/Berlin'),
});
export type CreateOrgInput = z.infer<typeof createOrgSchema>;

export const orgSettingsSchema = z
  .object({
    name: orgName.optional(),
    timezone: timezone.optional(),
    defaultWeeklyLimitMin: weeklyLimit.optional(),
    minRestMin: z.number().int().min(0).max(1440).optional(),
    maxDailyMin: z.number().int().min(60).max(1440).optional(),
    offerLeadTimeMin: z.number().int().min(0).max(2880).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Change at least one setting',
  });
export type OrgSettingsInput = z.infer<typeof orgSettingsSchema>;

export const createMemberSchema = z.object({
  displayName,
  email: z.string().trim().toLowerCase().email('Enter a valid email address').nullish(),
  accessLevel: accessLevel.default('EMPLOYEE'),
  skillIds: z.array(z.string().uuid()).default([]),
  weeklyLimitMin: weeklyLimit.nullish(),
  appOrigin: appOrigin.optional(),
});
export type CreateMemberInput = z.infer<typeof createMemberSchema>;

export const updateMemberSchema = z
  .object({
    displayName: displayName.optional(),
    accessLevel: accessLevel.optional(),
    skillIds: z.array(z.string().uuid()).optional(),
    weeklyLimitMin: weeklyLimit.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Change at least one field',
  });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const resendInviteSchema = z.object({ appOrigin: appOrigin.optional() });
export type ResendInviteInput = z.infer<typeof resendInviteSchema>;

export const skillSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(40, 'Use at most 40 characters'),
});
export type SkillInput = z.infer<typeof skillSchema>;

export interface OrgDto {
  id: string;
  name: string;
  timezone: string;
  defaultWeeklyLimitMin: number;
  minRestMin: number;
  maxDailyMin: number;
  offerLeadTimeMin: number;
}

export interface InvitePreviewDto {
  organizationName: string;
  email: string;
  expiresAt: string;
  state: 'VALID' | 'USED' | 'EXPIRED' | 'REVOKED';
}

export interface AuditEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: string;
}
