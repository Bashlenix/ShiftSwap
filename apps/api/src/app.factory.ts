import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import { json, type Express, type NextFunction, type Request, type Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AUTH, type Auth } from './auth/auth';
import { isTrustedOrigin } from './config/auth-config';
import { AppModule } from './app.module';
import type { PrismaClient } from './generated/prisma/client';

export interface CreateAppOptions {
  /** Replaces the PrismaService provider (used by tests). */
  prisma?: PrismaClient;
}

/** Single wiring point used by main.ts and every test. */
export async function createApp(options: CreateAppOptions = {}): Promise<INestApplication> {
  // bodyParser is off so Better Auth can be mounted before the JSON parser.
  const app = await NestFactory.create(AppModule.register({ prisma: options.prisma }), {
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  // Better Auth reads the raw body itself, so it must come before the JSON parser.
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.set('trust proxy', 1);
  // Better Auth only checks Origin when a cookie is present; also reject untrusted
  // origins on cookie-less state-changing requests (e.g. login CSRF).
  expressApp.use('/api/auth', (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !isTrustedOrigin(origin, process.env)) {
      res.status(403).json({ message: 'Invalid origin' });
      return;
    }
    next();
  });
  expressApp.all('/api/auth/*splat', toNodeHandler(app.get<Auth>(AUTH)));
  app.use(json());
  app.enableShutdownHooks();
  return app;
}
