import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RetentionError, RetentionService } from './retention.service';

export const RETENTION_CRON = '0 3 * * *';

/**
 * Runs the retention purge nightly at 03:00 UTC. Only registered when ScheduleModule is loaded,
 * i.e. not under NODE_ENV=test. Logs counts and error names only.
 */
@Injectable()
export class RetentionScheduler {
  private readonly logger = new Logger(RetentionScheduler.name);

  constructor(private readonly retention: RetentionService) {}

  @Cron(RETENTION_CRON, { timeZone: 'UTC' })
  async tick(): Promise<void> {
    try {
      const counts = await this.retention.purge(new Date());
      this.logger.log(counts);
    } catch (err) {
      const name = err instanceof Error ? err.name : typeof err;
      if (err instanceof AggregateError) {
        // Names only, never messages. Counts show what the other categories still purged.
        const causes = err.errors.map((e: unknown) => (e instanceof Error ? e.name : typeof e));
        const counts = err instanceof RetentionError ? err.counts : undefined;
        this.logger.error({ err: name, causes, ...(counts ? { counts } : {}) });
      } else {
        this.logger.error({ err: name });
      }
    }
  }
}
