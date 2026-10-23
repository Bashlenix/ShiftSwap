import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './health/health.controller';
import type { PrismaClient } from './generated/prisma/client';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  static register(options: { prisma?: PrismaClient } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            redact: ['req.headers.cookie', 'req.headers.authorization'],
            // IDs only: never log request bodies, emails or names.
            serializers: {
              req: (req: { id: unknown; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
            },
            autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health/') },
          },
        }),
        PrismaModule.register(options.prisma),
      ],
      controllers: [HealthController],
    };
  }
}
