import { DynamicModule, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OffersModule } from '../offers/offers.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DeactivationService } from './deactivation.service';
import { MembersController } from './members.controller';
import { MEMBERS_ENV, MembersService } from './members.service';

@Module({})
export class MembersModule {
  /** `env` is the same environment the app's Origin guard reads (see AppModule.register). */
  static register(env: NodeJS.ProcessEnv): DynamicModule {
    return {
      module: MembersModule,
      imports: [TenancyModule, OffersModule, NotificationsModule],
      controllers: [MembersController],
      providers: [MembersService, DeactivationService, { provide: MEMBERS_ENV, useValue: env }],
    };
  }
}
