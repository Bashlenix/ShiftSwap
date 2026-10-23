import type { INestApplication } from '@nestjs/common';
import type { AccessLevel } from '@shiftswap/shared';
import request from 'supertest';
import { createApp } from '../../src/app.factory';
import { AUTH, type Auth } from '../../src/auth/auth';
import type { Prisma } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

export const TEST_ORIGIN = 'http://localhost:5173';
const PASSWORD = 'correct-horse-battery';

export interface TestCtx {
  app: INestApplication;
  prisma: PrismaService;
  auth: Auth;
}

export async function createTestApp(): Promise<TestCtx> {
  const app = await createApp();
  await app.init();
  return { app, prisma: app.get(PrismaService), auth: app.get<Auth>(AUTH) };
}

let counter = 0;
const unique = () => `${Date.now()}-${counter++}`;

export async function makeOrg(
  prisma: PrismaService,
  opts: Partial<Prisma.OrganizationUncheckedCreateInput> = {},
): Promise<{ orgId: string }> {
  const org = await prisma.organization.create({
    data: { name: `Test Org ${unique()}`, ...opts },
  });
  return { orgId: org.id };
}

export async function makeMember(
  ctx: Pick<TestCtx, 'prisma' | 'auth'>,
  orgId: string,
  opts: {
    accessLevel: AccessLevel;
    name?: string;
    skillNames?: string[];
    withLogin?: boolean;
  },
): Promise<{ membershipId: string; userId?: string; cookie?: string }> {
  const { prisma, auth } = ctx;
  const name = opts.name ?? `Member ${unique()}`;
  let userId: string | undefined;
  let cookie: string | undefined;
  let email: string | undefined;

  if (opts.withLogin ?? true) {
    email = `member-${unique()}@shiftswap.test`;
    const signedUp = await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } });
    userId = signedUp.user.id;
    const { headers } = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    cookie = headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
  }

  const membership = await prisma.membership.create({
    data: {
      organizationId: orgId,
      userId: userId ?? null,
      displayName: name,
      email: email ?? null,
      accessLevel: opts.accessLevel,
    },
  });

  for (const skillName of opts.skillNames ?? []) {
    const skill = await prisma.skill.upsert({
      where: { organizationId_name: { organizationId: orgId, name: skillName } },
      update: {},
      create: { organizationId: orgId, name: skillName },
    });
    await prisma.membershipSkill.create({
      data: { membershipId: membership.id, skillId: skill.id },
    });
  }
  return { membershipId: membership.id, userId, cookie };
}

/** supertest wrapper presetting the trusted Origin and (optionally) the session cookie. */
export function api(app: INestApplication, cookie?: string) {
  const server = app.getHttpServer();
  const preset = (req: request.Test) => {
    req.set('Origin', TEST_ORIGIN);
    return cookie ? req.set('Cookie', cookie) : req;
  };
  return {
    get: (url: string) => preset(request(server).get(url)),
    post: (url: string) => preset(request(server).post(url)),
    patch: (url: string) => preset(request(server).patch(url)),
    put: (url: string) => preset(request(server).put(url)),
    delete: (url: string) => preset(request(server).delete(url)),
  };
}
