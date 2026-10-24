import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

@Module({ imports: [TenancyModule], controllers: [OrgsController], providers: [OrgsService] })
export class OrgsModule {}
