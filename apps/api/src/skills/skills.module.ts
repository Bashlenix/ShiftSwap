import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

@Module({ imports: [TenancyModule], controllers: [SkillsController], providers: [SkillsService] })
export class SkillsModule {}
