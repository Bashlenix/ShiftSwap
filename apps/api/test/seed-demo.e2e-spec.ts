import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { createAuth } from '../src/auth/auth';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEMO_PASSWORD } from '../src/seed/demo-data';
import { seedDemo } from '../src/seed/seed-demo';

const COUNTS = { users: 6, organizations: 2, memberships: 8 };

describe('seedDemo', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('seeds the demo data and is idempotent', async () => {
    const auth = createAuth(prisma, process.env);
    expect(await seedDemo(prisma, auth)).toEqual(COUNTS);
    expect(await seedDemo(prisma, auth)).toEqual(COUNTS);

    const lukas = await prisma.user.findUniqueOrThrow({
      where: { email: 'lukas@shiftswap.test' },
      include: { memberships: true },
    });
    expect(lukas.memberships.filter((m) => m.status === 'ACTIVE')).toHaveLength(2);

    const paul = await prisma.membership.findFirstOrThrow({
      where: { displayName: 'Paul Weber' },
    });
    expect(paul.userId).toBeNull();
    expect(paul.email).toBeNull();
    expect(paul.accessLevel).toBe('EMPLOYEE');
  });

  it('lets a demo user sign in with a mixed-case email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', 'http://localhost:5173')
      .set('X-Forwarded-For', '10.9.0.1')
      .send({ email: 'Anna@ShiftSwap.test', password: DEMO_PASSWORD })
      .expect(200);
  });
});
