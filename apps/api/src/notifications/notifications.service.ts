import { Injectable } from '@nestjs/common';
import type { NotificationDto, NotificationPayload, NotificationType } from '@shiftswap/shared';
import { DomainError } from '../common/domain-error';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;
type Role = NonNullable<NotificationPayload['role']>;

export interface RecipientGroup {
  role: Role;
  ids: readonly string[];
}

export interface NotificationPage {
  items: NotificationDto[];
  nextCursor: string | null;
}

const invalidCursor = () =>
  new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: [{ path: 'cursor', message: 'Invalid cursor' }],
  });

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (extra !== undefined || !id || Number.isNaN(createdAt.getTime())) throw invalidCursor();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw invalidCursor();
  }
  return { createdAt, id };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one notification per eligible recipient inside the caller's transaction. Drops the
   * actor, duplicates, and memberships that are not ACTIVE with a login (one query). Returns rows written.
   */
  notify(
    tx: Tx,
    orgId: string,
    recipients: readonly string[],
    type: NotificationType,
    payload: NotificationPayload,
    actorMembershipId: string | null,
  ): Promise<number> {
    return this.write(
      tx,
      orgId,
      type,
      actorMembershipId,
      new Map(recipients.map((r) => [r, payload])),
    );
  }

  /**
   * Like `notify`, but each group carries its own `role`. A recipient listed in several groups
   * gets ONE row, with the role of the first group that names them.
   */
  notifyGroups(
    tx: Tx,
    orgId: string,
    groups: readonly RecipientGroup[],
    type: NotificationType,
    payload: NotificationPayload,
    actorMembershipId: string | null,
  ): Promise<number> {
    const byRecipient = new Map<string, NotificationPayload>();
    for (const g of groups) {
      for (const id of g.ids) {
        if (!byRecipient.has(id)) byRecipient.set(id, { ...payload, role: g.role });
      }
    }
    return this.write(tx, orgId, type, actorMembershipId, byRecipient);
  }

  /** ACTIVE memberships with MANAGER or ADMIN access (logins are filtered at write time). */
  async managerIds(tx: Tx, orgId: string): Promise<string[]> {
    const rows = await tx.membership.findMany({
      where: {
        organizationId: orgId,
        status: 'ACTIVE',
        accessLevel: { in: ['MANAGER', 'ADMIN'] },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async write(
    tx: Tx,
    orgId: string,
    type: NotificationType,
    actorMembershipId: string | null,
    byRecipient: Map<string, NotificationPayload>,
  ): Promise<number> {
    if (actorMembershipId) byRecipient.delete(actorMembershipId);
    if (byRecipient.size === 0) return 0;
    const valid = await tx.membership.findMany({
      where: {
        id: { in: [...byRecipient.keys()] },
        organizationId: orgId,
        status: 'ACTIVE',
        userId: { not: null },
      },
      select: { id: true },
    });
    if (valid.length === 0) return 0;
    const { count } = await tx.notification.createMany({
      data: valid.map((m) => ({
        organizationId: orgId,
        recipientMembershipId: m.id,
        type,
        payload: byRecipient.get(m.id) as Prisma.InputJsonObject,
      })),
    });
    return count;
  }

  async list(
    orgId: string,
    membershipId: string,
    limit: number,
    cursor?: string,
  ): Promise<NotificationPage> {
    const after = cursor ? decodeCursor(cursor) : null;
    const rows = await this.prisma.notification.findMany({
      where: {
        organizationId: orgId,
        recipientMembershipId: membershipId,
        ...(after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((n) => ({
        id: n.id,
        type: n.type,
        payload: n.payload as NotificationPayload,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  unreadCount(orgId: string, membershipId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { organizationId: orgId, recipientMembershipId: membershipId, readAt: null },
    });
  }

  /** Marks the caller's own unread rows read (all of them when `ids` is omitted). */
  async markRead(orgId: string, membershipId: string, ids?: string[]): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        organizationId: orgId,
        recipientMembershipId: membershipId,
        readAt: null,
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
  }
}
