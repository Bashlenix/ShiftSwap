import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OffersService } from './offers.service';

export const EXPIRY_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Expires due OPEN offers every 5 minutes (lazy expiry covers the gaps). Only registered when
 * ScheduleModule is loaded, i.e. not under NODE_ENV=test. Logs non-zero counts and error names only.
 */
@Injectable()
export class ExpiryScheduler {
  private readonly logger = new Logger(ExpiryScheduler.name);

  constructor(private readonly offers: OffersService) {}

  @Interval(EXPIRY_INTERVAL_MS)
  async tick(): Promise<void> {
    try {
      const expired = await this.offers.expireDue(new Date());
      if (expired > 0) this.logger.log({ expired });
    } catch (err) {
      this.logger.error({ err: err instanceof Error ? err.name : typeof err });
    }
  }
}
