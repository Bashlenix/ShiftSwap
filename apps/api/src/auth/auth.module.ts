import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AUTH, createAuth } from './auth';
import { SessionGuard } from './session.guard';

@Global()
@Module({
  providers: [
    {
      provide: AUTH,
      useFactory: (prisma: PrismaService) => createAuth(prisma),
      inject: [PrismaService],
    },
    SessionGuard,
  ],
  exports: [AUTH, SessionGuard],
})
export class AuthModule {}
