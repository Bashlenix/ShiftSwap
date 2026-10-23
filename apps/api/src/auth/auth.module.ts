import { DynamicModule, Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH, createAuth } from './auth';
import { SessionGuard } from './session.guard';

@Global()
@Module({})
export class AuthModule {
  /** `env` is the same environment the app's Origin guard reads (tests inject their own). */
  static register(env: NodeJS.ProcessEnv): DynamicModule {
    return {
      module: AuthModule,
      providers: [
        {
          provide: AUTH,
          useFactory: (prisma: PrismaService) => createAuth(prisma, env),
          inject: [PrismaService],
        },
        SessionGuard,
      ],
      exports: [AUTH, SessionGuard],
    };
  }
}
