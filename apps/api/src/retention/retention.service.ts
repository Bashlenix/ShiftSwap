import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../prisma/prisma.service';

export interface RetentionCounts {
  shifts: number;
  offers: number;
  acceptances: number;
  auditLogs: number;
  notifications: number;
  unavailabilities: number;
}

const SHIFT_BATCH = 500;
const AUDIT_BATCH = 5000;

/**
 * Nightly retention purge (SDD §27). Deletes only old, terminal data, so it takes no workflow
 * locks. Cutoffs are strict `<`, computed in UTC.
 *
 * This is the ONLY code allowed to delete audit rows (SDD §26).
 */
@Injectable()
export class RetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async purge(now: Date): Promise<RetentionCounts> {
    const utc = DateTime.fromJSDate(now, { zone: 'utc' });
    const shiftCutoff = utc.minus({ months: 24 }).toJSDate();
    const notificationCutoff = utc.minus({ days: 90 }).toJSDate();
    const unavailabilityCutoff = utc.minus({ days: 30 }).toJSDate();

    const counts: RetentionCounts = {
      shifts: 0,
      offers: 0,
      acceptances: 0,
      auditLogs: 0,
      notifications: 0,
      unavailabilities: 0,
    };

    // Shifts (soft-deleted or not) by end_at; acceptances → offers → shifts per batch.
    for (;;) {
      const batch = await this.prisma.shift.findMany({
        where: { endAt: { lt: shiftCutoff } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: SHIFT_BATCH,
      });
      if (batch.length === 0) break;
      const ids = batch.map((s) => s.id);
      await this.prisma.$transaction(async (tx) => {
        counts.acceptances += (
          await tx.acceptance.deleteMany({ where: { offer: { shiftId: { in: ids } } } })
        ).count;
        counts.offers += (await tx.offer.deleteMany({ where: { shiftId: { in: ids } } })).count;
        counts.shifts += (await tx.shift.deleteMany({ where: { id: { in: ids } } })).count;
      });
      if (batch.length < SHIFT_BATCH) break;
    }

    // Audit rows by created_at, in id batches.
    for (;;) {
      const batch = await this.prisma.auditLog.findMany({
        where: { createdAt: { lt: shiftCutoff } },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: AUDIT_BATCH,
      });
      if (batch.length === 0) break;
      counts.auditLogs += (
        await this.prisma.auditLog.deleteMany({ where: { id: { in: batch.map((a) => a.id) } } })
      ).count;
      if (batch.length < AUDIT_BATCH) break;
    }

    // By created_at, regardless of email_dispatched_at.
    counts.notifications = (
      await this.prisma.notification.deleteMany({
        where: { createdAt: { lt: notificationCutoff } },
      })
    ).count;
    counts.unavailabilities = (
      await this.prisma.unavailability.deleteMany({
        where: { endAt: { lt: unavailabilityCutoff } },
      })
    ).count;

    return counts;
  }
}
