import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { DirectoryController } from './directory.controller';

@Module({ imports: [TenancyModule], controllers: [DirectoryController] })
export class DirectoryModule {}
