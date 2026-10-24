import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MatchingModule } from '../matching/matching.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ExpiryScheduler } from './expiry.scheduler';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [TenancyModule, MatchingModule, ShiftsModule, NotificationsModule],
  controllers: [OffersController],
  providers: [OffersService, ExpiryScheduler],
  exports: [OffersService],
})
export class OffersModule {}
