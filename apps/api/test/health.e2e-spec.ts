import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createApp } from '../src/app.factory';

describe('health', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it('GET /health/live → 200 {status:"ok"}', async () => {
    app = await createApp();
    await app.init();
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready → 200 {status:"ok"} when DB reachable', async () => {
    app = await createApp();
    await app.init();
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready → 503 {status:"unavailable"} when DB query throws', async () => {
    const prisma = {
      $queryRaw: () => Promise.reject(new Error('db down')),
      $connect: () => Promise.resolve(),
      $disconnect: () => Promise.resolve(),
    } as unknown as PrismaClient;
    app = await createApp({ prisma });
    await app.init();
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});
