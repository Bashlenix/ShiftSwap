import { DynamicModule, Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy/tenancy.module';
import { MembersController } from './members.controller';
import { MEMBERS_ENV, MembersService } from './members.service';

@Module({})
export class MembersModule {
  /** `env` is the same environment the app's Origin guard reads (see AppModule.register). */
  static register(env: NodeJS.ProcessEnv): DynamicModule {
    return {
      module: MembersModule,
      imports: [TenancyModule],
      controllers: [MembersController],
      providers: [MembersService, { provide: MEMBERS_ENV, useValue: env }],
    };
  }
}
