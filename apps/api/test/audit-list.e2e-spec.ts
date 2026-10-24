import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; cookie?: string };

describe('GET orgs/:orgId/audit', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let otherOrgId: string;
  let mgr: Member;
  let emp: Member;

  const url = (q = '') => `/api/v1/orgs/${orgId}/audit${q}`;
  const insert = (
    org: string,
    over: { actor?: string | null; entityType?: string; entityId?: string; action?: string } = {},
  ) =>
    ctx.prisma.auditLog.create({
      data: {
        organizationId: org,
        actorMembershipId: over.actor === undefined ? null : over.actor,
        action: over.action ?? 'test.action',
        entityType: over.entityType ?? 'shift',
        entityId: over.entityId ?? 'e-1',
        after: { x: 1 },
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    orgId = (await makeOrg(ctx.prisma)).orgId;
    otherOrgId = (await makeOrg(ctx.prisma)).orgId;
    mgr = await makeMember(ctx, orgId, { accessLevel: 'MANAGER' });
    emp = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('lists only the own org, newest first, with string ids', async () => {
    const a = await insert(orgId, { entityId: 'own-1' });
    const b = await insert(orgId, { entityId: 'own-2' });
    await insert(otherOrgId, { entityId: 'foreign' });
    const res = await api(app, mgr.cookie).get(url('?entityType=shift'));
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids.slice(0, 2)).toEqual([String(b.id), String(a.id)]);
    expect(res.body.items.every((i: { entityId: string }) => i.entityId !== 'foreign')).toBe(true);
    expect(typeof res.body.items[0].id).toBe('string');
    expect(res.body.items[0]).toMatchObject({ after: { x: 1 }, actorName: null });
    expect(typeof res.body.items[0].createdAt).toBe('string');
  });

  it('filters by entityType and entityId', async () => {
    await insert(orgId, { entityType: 'offer', entityId: 'filter-me' });
    await insert(orgId, { entityType: 'offer', entityId: 'other' });
    const byType = await api(app, mgr.cookie).get(url('?entityType=offer'));
    expect(byType.body.items.length).toBeGreaterThanOrEqual(2);
    expect(byType.body.items.every((i: { entityType: string }) => i.entityType === 'offer')).toBe(
      true,
    );
    const byId = await api(app, mgr.cookie).get(url('?entityType=offer&entityId=filter-me'));
    expect(byId.body.items).toHaveLength(1);
    expect(byId.body.items[0].entityId).toBe('filter-me');
  });

  it('rejects an unknown entityType, bad limit, bad cursor, long entityId with 400', async () => {
    for (const q of [
      '?entityType=bogus',
      '?limit=0',
      '?limit=101',
      '?limit=abc',
      '?cursor=abc',
      '?cursor=0',
      '?cursor=-5',
      '?cursor=1.5',
      `?entityId=${'x'.repeat(101)}`,
    ]) {
      const res = await api(app, mgr.cookie).get(url(q));
      expect([q, res.status]).toEqual([q, 400]);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('paginates with a cursor that is stable under inserts', async () => {
    const org = (await makeOrg(ctx.prisma)).orgId;
    const m = await makeMember(ctx, org, { accessLevel: 'MANAGER' });
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await insert(org, { entityId: `p-${i}` }));
    const u = (q: string) => `/api/v1/orgs/${org}/audit${q}`;
    const p1 = await api(app, m.cookie).get(u('?limit=2'));
    expect(p1.body.items.map((i: { entityId: string }) => i.entityId)).toEqual(['p-4', 'p-3']);
    expect(p1.body.nextCursor).toEqual(expect.any(String));
    await insert(org, { entityId: 'inserted-late' });
    const p2 = await api(app, m.cookie).get(u(`?limit=2&cursor=${p1.body.nextCursor}`));
    expect(p2.body.items.map((i: { entityId: string }) => i.entityId)).toEqual(['p-2', 'p-1']);
    const p3 = await api(app, m.cookie).get(u(`?limit=2&cursor=${p2.body.nextCursor}`));
    expect(p3.body.items.map((i: { entityId: string }) => i.entityId)).toEqual(['p-0']);
    expect(p3.body.nextCursor).toBeNull();
  });

  it('is manager-only: employee gets 403', async () => {
    expect((await api(app, emp.cookie).get(url())).status).toBe(403);
  });

  it('actorName is the actor displayName, null for the system', async () => {
    const org = (await makeOrg(ctx.prisma)).orgId;
    const m = await makeMember(ctx, org, { accessLevel: 'MANAGER' });
    await ctx.prisma.membership.update({
      where: { id: m.membershipId },
      data: { displayName: 'Maria Manager' },
    });
    await insert(org, { actor: null, entityId: 'sys' });
    await insert(org, { actor: m.membershipId, entityId: 'human' });
    const res = await api(app, m.cookie).get(`/api/v1/orgs/${org}/audit`);
    const by = Object.fromEntries(
      res.body.items.map((i: { entityId: string; actorName: string | null }) => [
        i.entityId,
        i.actorName,
      ]),
    );
    expect(by).toMatchObject({ sys: null, human: 'Maria Manager' });
  });
});
