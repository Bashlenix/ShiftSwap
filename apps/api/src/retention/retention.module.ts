import { Module } from '@nestjs/common';
import { RetentionScheduler } from './retention.scheduler';
import { RetentionService } from './retention.service';

@Module({
  providers: [RetentionService, RetentionScheduler],
  exports: [RetentionService],
})
export class RetentionModule {}
