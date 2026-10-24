import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationMailer } from './notification-mailer';

export const NOTIFICATION_MAIL_INTERVAL_MS = 60_000;

/**
 * Safety net for the outbox: dispatches pending notification emails every 60 s (rows written
 * by the expiry sweep, or missed by the request interceptor). Only registered when
 * ScheduleModule is loaded, i.e. not under NODE_ENV=test. Logs counts and error names only.
 */
@Injectable()
export class NotificationMailScheduler {
  private readonly logger = new Logger(NotificationMailScheduler.name);

  constructor(private readonly mailer: NotificationMailer) {}

  @Interval(NOTIFICATION_MAIL_INTERVAL_MS)
  async tick(): Promise<void> {
    try {
      const sent = await this.mailer.dispatchPending();
      if (sent > 0) this.logger.log({ sent });
    } catch (err) {
      this.logger.error({ err: err instanceof Error ? err.name : typeof err });
    }
  }
}
