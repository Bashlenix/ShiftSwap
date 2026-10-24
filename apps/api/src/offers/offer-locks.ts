import { DomainError } from '../common/domain-error';
import type { Prisma } from '../generated/prisma/client';

type Tx = Prisma.TransactionClient;

/*
 * Row locks for the swap workflow (SDD §25). Each lock is scoped by organization_id, so a
 * foreign-org id looks like a missing one (404). Callers MUST lock in the order
 * offer -> shift -> membership to avoid deadlocks. Only valid inside `prisma.$transaction`.
 */

const notFound = () => new DomainError('NOT_FOUND', 'Not found');

export async function lockOffer(tx: Tx, orgId: string, offerId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "offers" WHERE id = ${offerId} AND organization_id = ${orgId} FOR UPDATE`;
  if (rows.length === 0) throw notFound();
}

export async function lockShift(tx: Tx, orgId: string, shiftId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "shifts" WHERE id = ${shiftId} AND organization_id = ${orgId} FOR UPDATE`;
  if (rows.length === 0) throw notFound();
}

// NO KEY UPDATE still serialises lockMembership callers but does not conflict with the FOR KEY SHARE
// that notification inserts take on recipient rows (FK), which would otherwise risk deadlocks.
export async function lockMembership(tx: Tx, orgId: string, membershipId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "memberships" WHERE id = ${membershipId} AND organization_id = ${orgId} FOR NO KEY UPDATE`;
  if (rows.length === 0) throw notFound();
}
