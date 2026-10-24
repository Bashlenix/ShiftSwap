import { Module } from '@nestjs/common';
import { EligibilityLoader } from './eligibility-loader';

@Module({ providers: [EligibilityLoader], exports: [EligibilityLoader] })
export class MatchingModule {}
