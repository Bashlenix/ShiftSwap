import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({
  imports: [TenancyModule, MatchingModule, ShiftsModule],
  controllers: [OffersController],
  providers: [OffersService],
  exports: [OffersService],
})
export class OffersModule {}
