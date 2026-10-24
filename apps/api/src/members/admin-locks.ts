import { DomainError } from '../common/domain-error';
import type { Membership, Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Locks the target membership AND every active admin of the org in ONE statement ordered
 * by id, so concurrent callers always acquire the row locks in the same order (no
 * deadlock between two admins demoting each other). Missing/foreign target -> 404.
 * Only valid inside `prisma.$transaction`.
 */
export async function lockMemberAndAdmins(
  tx: Tx,
  orgId: string,
  membershipId: string,
): Promise<{ target: Membership; activeAdminIds: string[] }> {
  const rows = await tx.$queryRaw<{ id: string; access_level: string; status: string }[]>`
    SELECT id, access_level, status FROM "memberships"
    WHERE organization_id = ${orgId}
      AND (id = ${membershipId} OR (access_level = 'ADMIN' AND status = 'ACTIVE'))
    ORDER BY id FOR NO KEY UPDATE`;
  if (!rows.some((r) => r.id === membershipId)) throw new DomainError('NOT_FOUND', 'Not found');
  const target = await tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
  const activeAdminIds = rows
    .filter((r) => r.access_level === 'ADMIN' && r.status === 'ACTIVE')
    .map((r) => r.id);
  return { target, activeAdminIds };
}
