import { Module } from '@nestjs/common';
import { MatchingModule } from '../matching/matching.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [TenancyModule, MatchingModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
