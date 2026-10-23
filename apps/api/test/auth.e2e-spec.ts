import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/app.factory';
import { PrismaService } from '../src/prisma/prisma.service';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'correct-horse-battery';

describe('auth + /me', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let n = 0;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function signUp(): Promise<{ email: string; cookie: string; id: string }> {
    const email = `user${Date.now()}-${n++}@shiftswap.test`;
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send({ name: 'Test User', email, password: PASSWORD })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email, password: PASSWORD })
      .expect(200);
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie.join(';')).toMatch(/session_token/);
    expect(setCookie.join(';')).toMatch(/HttpOnly/i);
    expect(setCookie.join(';')).toMatch(/SameSite=Lax/i);
    const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    return { email, cookie, id: user.id };
  }

  it('signs up, signs in and returns /me with no memberships', async () => {
    const { email, cookie } = await signUp();
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.user.email).toBe(email);
    expect(res.body.memberships).toEqual([]);
  });

  it('returns ACTIVE memberships only, sorted by organization name', async () => {
    const { cookie, id, email } = await signUp();
    const b = await prisma.organization.create({ data: { name: 'Zeta Bakery' } });
    const a = await prisma.organization.create({ data: { name: 'Alpha Cafe' } });
    const c = await prisma.organization.create({ data: { name: 'Gone Shop' } });
    await prisma.membership.create({
      data: {
        organizationId: b.id,
        userId: id,
        displayName: 'T',
        email,
        accessLevel: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: a.id,
        userId: id,
        displayName: 'T',
        email,
        accessLevel: 'MANAGER',
        status: 'ACTIVE',
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: c.id,
        userId: id,
        displayName: 'T',
        email,
        accessLevel: 'EMPLOYEE',
        status: 'DEACTIVATED',
      },
    });
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(res.body.memberships).toEqual([
      { organizationId: a.id, organizationName: 'Alpha Cafe', accessLevel: 'MANAGER' },
      { organizationId: b.id, organizationName: 'Zeta Bakery', accessLevel: 'ADMIN' },
    ]);
  });

  it('GET /api/v1/me without a cookie is 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/me').expect(401);
  });

  it('wrong password is 401', async () => {
    const { email } = await signUp();
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email, password: 'not-the-password' })
      .expect(401);
  });

  it('sign-in from an untrusted origin is 403', async () => {
    const { email } = await signUp();
    await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', 'https://evil.example')
      .send({ email, password: PASSWORD })
      .expect(403);
  });
});
