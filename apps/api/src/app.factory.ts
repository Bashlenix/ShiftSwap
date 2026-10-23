import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { PrismaClient } from './generated/prisma/client';

export interface CreateAppOptions {
  /** Replaces the PrismaService provider (used by tests). */
  prisma?: PrismaClient;
}

/** Single wiring point used by main.ts and every test. */
export async function createApp(options: CreateAppOptions = {}): Promise<INestApplication> {
  // bodyParser is off so Better Auth (Task 4) can be mounted before the JSON parser.
  const app = await NestFactory.create(AppModule.register({ prisma: options.prisma }), {
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.use(json());
  app.enableShutdownHooks();
  return app;
}
