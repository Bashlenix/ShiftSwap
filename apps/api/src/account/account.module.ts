import { Module } from '@nestjs/common';
import { DeactivationService } from '../members/deactivation.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OffersModule } from '../offers/offers.module';
import { AccountService } from './account.service';

/**
 * DeactivationService is stateless; it is provided here directly because MembersModule is a
 * dynamic module registered with the app env (importing it again would need that env).
 */
@Module({
  imports: [OffersModule, NotificationsModule],
  providers: [AccountService, DeactivationService],
  exports: [AccountService],
})
export class AccountModule {}
