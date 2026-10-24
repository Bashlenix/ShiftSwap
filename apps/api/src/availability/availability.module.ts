import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { PreferencesController } from './preferences.controller';
import { UnavailabilityController } from './unavailability.controller';

@Module({
  imports: [TenancyModule],
  controllers: [UnavailabilityController, PreferencesController],
})
export class AvailabilityModule {}
