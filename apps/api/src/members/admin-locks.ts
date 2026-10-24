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

/**
 * Locks the member's open (not accepted, not revoked) invites ascending by id. Invite locks
 * come BEFORE any membership lock: accepting an invite locks invite -> membership, so every
 * path that touches a member's invites (deactivation, re-sending) must take them first.
 */
export async function lockOpenInvites(tx: Tx, orgId: string, membershipId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM "invites"
     WHERE organization_id = ${orgId} AND membership_id = ${membershipId}
       AND accepted_at IS NULL AND revoked_at IS NULL
     ORDER BY id FOR UPDATE`;
}
