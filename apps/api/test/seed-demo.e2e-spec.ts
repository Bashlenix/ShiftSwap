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

  it('resets tables added later that reference memberships (FK RESTRICT)', async () => {
    const auth = createAuth(prisma, process.env);
    await seedDemo(prisma, auth);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE test_reset_notes (
         id serial PRIMARY KEY,
         membership_id text NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT
       )`,
    );
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO test_reset_notes (membership_id) SELECT id FROM memberships LIMIT 1`,
      );
      expect(await seedDemo(prisma, auth)).toEqual(COUNTS);
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM test_reset_notes`,
      );
      expect(Number(count)).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE test_reset_notes`);
    }
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
