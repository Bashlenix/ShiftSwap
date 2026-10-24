import { DomainError } from '../common/domain-error';
import type { Prisma } from '../generated/prisma/client';

/**
 * Validates and share-locks referenced skills (org-scoped, ascending id) BEFORE any join-row
 * write. FOR KEY SHARE conflicts with a skill delete's FOR UPDATE, so a concurrent delete either
 * finishes first (the skill is gone -> 404) or waits and then sees the new join row
 * (SKILL_IN_USE). Lock order: offer -> shift -> membership -> skill.
 */
export async function lockSkills(
  tx: Prisma.TransactionClient,
  orgId: string,
  skillIds: string[],
): Promise<void> {
  const unique = [...new Set(skillIds)];
  if (unique.length === 0) return;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "skills"
     WHERE organization_id = ${orgId} AND id = ANY(${unique}::text[])
     ORDER BY id FOR KEY SHARE`;
  if (rows.length !== unique.length) throw new DomainError('NOT_FOUND', 'Not found');
}
