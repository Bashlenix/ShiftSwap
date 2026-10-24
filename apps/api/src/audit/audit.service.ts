import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

export interface AuditEntry {
  orgId: string;
  actorMembershipId: string | null;
  action: string;
  entityType: 'organization' | 'shift' | 'offer' | 'acceptance' | 'unavailability';
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown> | null;
}

/** undefined -> omit the field; null -> SQL NULL (a JSON `null` would be stored otherwise). */
const json = (v: unknown) =>
  v === undefined ? undefined : v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

@Injectable()
export class AuditService {
  /** Writes inside the caller's transaction so the audit row commits with the change. IDs and scheduling fields only. */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId: entry.orgId,
        actorMembershipId: entry.actorMembershipId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: json(entry.before),
        after: json(entry.after),
        metadata: json(entry.metadata),
      },
    });
  }
}
