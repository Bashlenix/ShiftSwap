import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { UnavailabilityController } from './unavailability.controller';

@Module({ imports: [TenancyModule], controllers: [UnavailabilityController] })
export class AvailabilityModule {}
