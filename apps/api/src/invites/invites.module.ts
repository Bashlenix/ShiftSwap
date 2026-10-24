import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

/** ThrottlerGuard is applied on InvitesController only (no APP_GUARD), so no other route is limited. */
@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
