import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OfferLifecycle } from '../offers/offer-lifecycle';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [TenancyModule, MatchingModule, NotificationsModule],
  controllers: [ShiftsController],
  // OfferLifecycle lives here (not in OffersModule) so ShiftsService can call it without a module cycle.
  providers: [ShiftsService, OfferLifecycle],
  exports: [ShiftsService],
})
export class ShiftsModule {}
