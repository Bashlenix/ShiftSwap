import type { INestApplication } from '@nestjs/common';
import { createOfferSchema } from '@shiftswap/shared';
import { renderError } from '../src/common/error.filter';
import { ZodBody } from '../src/common/zod-body.pipe';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

describe('tenancy + directory', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgA: string;
  let orgB: string;
  let employee: { membershipId: string; cookie?: string };
  let manager: { membershipId: string; cookie?: string };
  let deactivated: { membershipId: string; cookie?: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgA = (await makeOrg(ctx.prisma)).orgId;
    orgB = (await makeOrg(ctx.prisma)).orgId;
    employee = await makeMember(ctx, orgA, {
      accessLevel: 'EMPLOYEE',
      name: 'Eve',
      skillNames: ['Bar'],
    });
    manager = await makeMember(ctx, orgA, { accessLevel: 'MANAGER', name: 'Adam' });
    await makeMember(ctx, orgA, { accessLevel: 'EMPLOYEE', name: 'Placeholder', withLogin: false });
    deactivated = await makeMember(ctx, orgA, { accessLevel: 'EMPLOYEE', name: 'Gone' });
    await ctx.prisma.membership.update({
      where: { id: deactivated.membershipId },
      data: { status: 'DEACTIVATED' },
    });
    await ctx.prisma.skill.create({ data: { organizationId: orgB, name: 'Other-tenant skill' } });
    await ctx.prisma.skill.create({ data: { organizationId: orgA, name: 'Aaa' } });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('member can list skills of own org, sorted by name', async () => {
    const res = await api(app, employee.cookie).get(`/api/v1/orgs/${orgA}/skills`).expect(200);
    expect(res.body.map((s: { name: string }) => s.name)).toEqual(['Aaa', 'Bar']);
  });

  it('other org is 404 NOT_FOUND', async () => {
    const res = await api(app, employee.cookie).get(`/api/v1/orgs/${orgB}/skills`).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('non-uuid orgId is 404', async () => {
    const res = await api(app, employee.cookie).get('/api/v1/orgs/not-a-uuid/skills').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('employee cannot list members: 403 FORBIDDEN', async () => {
    const res = await api(app, employee.cookie).get(`/api/v1/orgs/${orgA}/members`).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('manager lists ACTIVE members sorted by name, placeholder has hasLogin false', async () => {
    const res = await api(app, manager.cookie).get(`/api/v1/orgs/${orgA}/members`).expect(200);
    const names = res.body.map((m: { displayName: string }) => m.displayName);
    expect(names).toEqual(['Adam', 'Eve', 'Placeholder']);
    const placeholder = res.body.find(
      (m: { displayName: string }) => m.displayName === 'Placeholder',
    );
    expect(placeholder.hasLogin).toBe(false);
    expect(placeholder.skillIds).toEqual([]);
    const eve = res.body.find((m: { displayName: string }) => m.displayName === 'Eve');
    expect(eve).toMatchObject({
      hasLogin: true,
      accessLevel: 'EMPLOYEE',
      status: 'ACTIVE',
      weeklyLimitMin: null,
    });
    expect(eve.skillIds).toHaveLength(1);
  });

  it('deactivated membership is 404', async () => {
    await api(app, deactivated.cookie).get(`/api/v1/orgs/${orgA}/skills`).expect(404);
  });

  it('no session is 401 UNAUTHENTICATED in the error format', async () => {
    const res = await api(app).get(`/api/v1/orgs/${orgA}/skills`).expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('/me includes membershipId and organizationTimezone', async () => {
    const res = await api(app, employee.cookie).get('/api/v1/me').expect(200);
    expect(res.body.memberships).toEqual([
      expect.objectContaining({
        membershipId: employee.membershipId,
        organizationId: orgA,
        organizationTimezone: 'Europe/Berlin',
      }),
    ]);
  });

  it('a real offers_one_open_per_shift violation maps to 409 OFFER_ALREADY_OPEN', async () => {
    const { prisma } = ctx;
    const shift = await prisma.shift.create({
      data: {
        organizationId: orgA,
        startAt: new Date('2030-01-01T08:00:00Z'),
        endAt: new Date('2030-01-01T09:00:00Z'),
      },
    });
    const data = {
      organizationId: orgA,
      shiftId: shift.id,
      kind: 'OPEN_SHIFT' as const,
      status: 'OPEN' as const,
      createdByMembershipId: manager.membershipId,
      expiresAt: new Date('2030-01-01T06:00:00Z'),
    };
    await prisma.offer.create({ data });
    const err = await prisma.offer.create({ data }).catch((e: unknown) => e);
    expect(renderError(err)).toMatchObject({ status: 409, code: 'OFFER_ALREADY_OPEN' });
  });
});

describe('ZodBody', () => {
  it('throws VALIDATION_FAILED with path/message issues', () => {
    const pipe = ZodBody(createOfferSchema);
    expect(() => pipe.transform({ shiftId: 'x', kind: 'TRADE' }, { type: 'body' })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    try {
      pipe.transform({ shiftId: 'x' }, { type: 'body' });
    } catch (e) {
      const issues = (e as { details: { issues: { path: string; message: string }[] } }).details
        .issues;
      expect(issues.map((i) => i.path).sort()).toEqual(['kind', 'shiftId']);
    }
  });
});
