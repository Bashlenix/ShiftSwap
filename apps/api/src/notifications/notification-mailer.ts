import { Injectable } from '@nestjs/common';
import type { NotificationPayload } from '@shiftswap/shared';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppOriginRegistry } from './app-origin';
import { buildNotificationMail } from './notification-mail';

/**
 * Sends the emails for committed notification rows (the `notifications` table is the outbox).
 * At most once: rows are marked dispatched in their own short transaction BEFORE sending, so
 * overlapping dispatchers never send a row twice and a failed send is never retried (SDD §23).
 */
@Injectable()
export class NotificationMailer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly origins: AppOriginRegistry,
  ) {}

  /** Returns the number of emails handed to MailService.send. */
  async dispatchPending(limit = 100): Promise<number> {
    const ids = await this.claim(limit);
    if (ids.length === 0) return 0;

    const rows = await this.prisma.notification.findMany({
      where: { id: { in: ids } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        recipient: {
          select: { status: true, user: { select: { email: true, deletedAt: true } } },
        },
        organization: { select: { name: true, timezone: true } },
      },
    });

    const baseUrl = this.origins.baseUrl();
    let sent = 0;
    for (const row of rows) {
      const user = row.recipient.user;
      // Recipient gone since the row was written: skip; the row stays marked dispatched.
      if (row.recipient.status !== 'ACTIVE' || !user || user.deletedAt) continue;
      await this.mail.send(
        buildNotificationMail({
          to: user.email,
          orgName: row.organization.name,
          timeZone: row.organization.timezone,
          orgId: row.organizationId,
          baseUrl,
          type: row.type,
          payload: row.payload as NotificationPayload,
          recipientMembershipId: row.recipientMembershipId,
        }),
      );
      sent++;
    }
    return sent;
  }

  /**
   * Claims up to `limit` pending rows and marks them dispatched, then commits. SKIP LOCKED lets a
   * concurrent dispatcher take the next rows instead of waiting. Locks notification rows only
   * (outside the invites → offers → shifts → memberships → skills order).
   */
  private claim(limit: number): Promise<string[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "notifications" WHERE email_dispatched_at IS NULL
         ORDER BY created_at, id LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return ids;
      await tx.$executeRaw`
        UPDATE "notifications" SET email_dispatched_at = now() WHERE id = ANY(${ids}::text[])`;
      return ids;
    });
  }
}
