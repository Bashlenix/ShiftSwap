import { Module } from '@nestjs/common';
import { OrgGuard } from './org.guard';

@Module({ providers: [OrgGuard], exports: [OrgGuard] })
export class TenancyModule {}
