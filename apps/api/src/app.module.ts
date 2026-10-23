import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { pathOnly } from './config/log-url';
import { AuditModule } from './audit/audit.module';
import { DirectoryModule } from './directory/directory.module';
import { ShiftsModule } from './shifts/shifts.module';
import { MeController } from './me/me.controller';
import { HealthController } from './health/health.controller';
import type { PrismaClient } from './generated/prisma/client';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  static register(options: { prisma?: PrismaClient; env?: NodeJS.ProcessEnv } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            // Jest sets NODE_ENV=test; request logs would drown the test output.
            level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
            redact: ['req.headers.cookie', 'req.headers.authorization'],
            // IDs only: never log request bodies, emails or names.
            serializers: {
              req: (req: { id: unknown; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: pathOnly(req.url),
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health/') },
          },
        }),
        PrismaModule.register(options.prisma),
        AuthModule.register(options.env ?? process.env),
        AuditModule,
        DirectoryModule,
        ShiftsModule,
      ],
      controllers: [HealthController, MeController],
    };
  }
}
