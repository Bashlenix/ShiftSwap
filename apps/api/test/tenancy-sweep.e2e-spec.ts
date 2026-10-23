import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Actor = 'manager' | 'employee';
type Params = { orgId: string; shiftId: string; offerId: string; id: string };

interface Variant {
  name: string;
  actor: Actor;
  params?: Partial<Params>;
  query?: string;
  body?: (f: Fixture) => object;
}

interface Row {
  /** `METHOD path-template`, as registered by the controllers (without the global prefix). */
  route: string;
  /** Rejected with 403 for an EMPLOYEE. */
  managerOnly: boolean;
  /** Valid request against org A's own entities. */
  query?: string;
  body?: (f: Fixture) => object;
  /** Use the scratch offer for the EMPLOYEE reachability check (the route mutates). */
  scratchOffer?: boolean;
  /** Org A routes that receive org B entity ids (path or body): must answer 404. */
  foreign: Variant[];
}

interface Fixture {
  a: {
    orgId: string;
    manager: string;
    employee: string;
    shiftId: string;
    offerId: string;
    scratchOfferId: string;
    unavailId: string;
    mgrUnavailId: string;
    employeeMembershipId: string;
  };
  b: {
    orgId: string;
    shiftId: string;
    offerId: string;
    acceptanceId: string;
    unavailId: string;
    skillId: string;
    managerMembershipId: string;
    employeeMembershipId: string;
  };
  managerCookie: string;
  employeeCookie: string;
}

const day = 24 * 3600_000;
const when = (days: number, hours = 8) => {
  const start = new Date(Date.now() + days * day);
  return { startAt: start, endAt: new Date(start.getTime() + hours * 3600_000) };
};
const iso = (d: Date) => d.toISOString();
const RANGE = `from=${encodeURIComponent(iso(new Date(Date.now() - day)))}&to=${encodeURIComponent(iso(new Date(Date.now() + 10 * day)))}`;
const slot = (days: number) => {
  const w = when(days);
  return { startAt: iso(w.startAt), endAt: iso(w.endAt) };
};

const ROWS: Row[] = [
  { route: 'GET orgs/:orgId/members', managerOnly: true, foreign: [] },
  { route: 'GET orgs/:orgId/skills', managerOnly: false, foreign: [] },
  {
    route: 'GET orgs/:orgId/shifts',
    managerOnly: true,
    query: `?${RANGE}`,
    foreign: [],
  },
  {
    route: 'POST orgs/:orgId/shifts',
    managerOnly: true,
    body: () => ({ ...slot(30), assignedMembershipId: null, requiredSkillIds: [] }),
    foreign: [
      {
        name: 'requiredSkillIds of org B',
        actor: 'manager',
        body: (f) => ({ ...slot(30), assignedMembershipId: null, requiredSkillIds: [f.b.skillId] }),
      },
      {
        name: 'assignedMembershipId of org B',
        actor: 'manager',
        body: (f) => ({
          ...slot(30),
          assignedMembershipId: f.b.employeeMembershipId,
          requiredSkillIds: [],
        }),
      },
    ],
  },
  {
    route: 'PATCH orgs/:orgId/shifts/:shiftId',
    managerOnly: true,
    body: () => ({ version: 1, location: 'x' }),
    foreign: [
      { name: 'shiftId of org B', actor: 'manager', params: { shiftId: 'B' } },
      {
        name: 'requiredSkillIds of org B',
        actor: 'manager',
        body: (f) => ({ version: 1, requiredSkillIds: [f.b.skillId] }),
      },
      {
        name: 'assignedMembershipId of org B',
        actor: 'manager',
        body: (f) => ({ version: 1, assignedMembershipId: f.b.employeeMembershipId }),
      },
    ],
  },
  {
    route: 'DELETE orgs/:orgId/shifts/:shiftId',
    managerOnly: true,
    query: '?version=1',
    foreign: [{ name: 'shiftId of org B', actor: 'manager', params: { shiftId: 'B' } }],
  },
  { route: 'GET orgs/:orgId/me/unavailability', managerOnly: false, foreign: [] },
  {
    route: 'POST orgs/:orgId/me/unavailability',
    managerOnly: false,
    body: () => slot(40),
    foreign: [],
  },
  {
    route: 'DELETE orgs/:orgId/me/unavailability/:id',
    managerOnly: false,
    foreign: [
      { name: 'unavailability id of org B', actor: 'employee', params: { id: 'B' } },
      { name: 'unavailability id of a colleague', actor: 'employee', params: { id: 'MGR' } },
    ],
  },
  {
    route: 'POST orgs/:orgId/offers',
    managerOnly: false,
    body: (f) => ({ shiftId: f.a.shiftId, kind: 'GIVE_AWAY' }),
    foreign: [
      {
        name: 'shiftId of org B',
        actor: 'employee',
        body: (f) => ({ shiftId: f.b.shiftId, kind: 'GIVE_AWAY' }),
      },
      {
        name: 'shiftId of org B (open shift, manager)',
        actor: 'manager',
        body: (f) => ({ shiftId: f.b.shiftId, kind: 'OPEN_SHIFT' }),
      },
    ],
  },
  { route: 'GET orgs/:orgId/offers', managerOnly: false, query: '?scope=mine', foreign: [] },
  {
    route: 'GET orgs/:orgId/offers/:offerId',
    managerOnly: false,
    foreign: [{ name: 'offerId of org B', actor: 'manager', params: { offerId: 'B' } }],
  },
  {
    route: 'POST orgs/:orgId/offers/:offerId/cancel',
    managerOnly: false,
    scratchOffer: true,
    body: () => ({ version: 1 }),
    foreign: [{ name: 'offerId of org B', actor: 'manager', params: { offerId: 'B' } }],
  },
  {
    route: 'POST orgs/:orgId/offers/:offerId/acceptances',
    managerOnly: false,
    foreign: [{ name: 'offerId of org B', actor: 'employee', params: { offerId: 'B' } }],
  },
  {
    route: 'DELETE orgs/:orgId/offers/:offerId/acceptances/me',
    managerOnly: false,
    foreign: [{ name: 'offerId of org B', actor: 'employee', params: { offerId: 'B' } }],
  },
  {
    route: 'POST orgs/:orgId/offers/:offerId/claim',
    managerOnly: false,
    foreign: [{ name: 'offerId of org B', actor: 'employee', params: { offerId: 'B' } }],
  },
  {
    route: 'POST orgs/:orgId/offers/:offerId/approve',
    managerOnly: true,
    body: (f) => ({ acceptanceId: f.b.acceptanceId, version: 1 }),
    foreign: [
      { name: 'offerId of org B', actor: 'manager', params: { offerId: 'B' } },
      { name: 'acceptanceId of org B on own offer', actor: 'manager' },
    ],
  },
  {
    route: 'POST orgs/:orgId/offers/:offerId/reject',
    managerOnly: true,
    body: () => ({ version: 1 }),
    foreign: [{ name: 'offerId of org B', actor: 'manager', params: { offerId: 'B' } }],
  },
];

describe('tenancy and permission sweep', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let f: Fixture;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { prisma } = ctx;
    const orgA = await makeOrg(prisma);
    const orgB = await makeOrg(prisma);
    const aMgr = await makeMember(ctx, orgA.orgId, { accessLevel: 'MANAGER' });
    const aEmp = await makeMember(ctx, orgA.orgId, { accessLevel: 'EMPLOYEE' });
    const bMgr = await makeMember(ctx, orgB.orgId, { accessLevel: 'MANAGER' });
    const bEmp = await makeMember(ctx, orgB.orgId, {
      accessLevel: 'EMPLOYEE',
      skillNames: ['Kitchen'],
    });
    const skill = await prisma.skill.findFirstOrThrow({ where: { organizationId: orgB.orgId } });

    const mkOffer = async (orgId: string, owner: string) => {
      const w = when(20);
      const shift = await prisma.shift.create({
        data: { organizationId: orgId, assignedMembershipId: owner, ...w },
      });
      const offer = await prisma.offer.create({
        data: {
          organizationId: orgId,
          shiftId: shift.id,
          kind: 'GIVE_AWAY',
          originalOwnerMembershipId: owner,
          createdByMembershipId: owner,
          expiresAt: new Date(w.startAt.getTime() - 2 * 3600_000),
        },
      });
      return { shiftId: shift.id, offerId: offer.id };
    };
    const a = await mkOffer(orgA.orgId, aEmp.membershipId);
    const scratch = await mkOffer(orgA.orgId, aEmp.membershipId);
    const b = await mkOffer(orgB.orgId, bEmp.membershipId);
    const acc = await prisma.acceptance.create({
      data: {
        organizationId: orgB.orgId,
        offerId: b.offerId,
        membershipId: bMgr.membershipId,
        status: 'PENDING',
      },
    });
    const w = when(50, 1);
    const un = (orgId: string, membershipId: string) =>
      prisma.unavailability.create({ data: { organizationId: orgId, membershipId, ...w } });

    f = {
      a: {
        orgId: orgA.orgId,
        manager: aMgr.membershipId,
        employee: aEmp.membershipId,
        employeeMembershipId: aEmp.membershipId,
        ...a,
        scratchOfferId: scratch.offerId,
        unavailId: (await un(orgA.orgId, aEmp.membershipId)).id,
        mgrUnavailId: (await un(orgA.orgId, aMgr.membershipId)).id,
      },
      b: {
        orgId: orgB.orgId,
        ...b,
        acceptanceId: acc.id,
        unavailId: (await un(orgB.orgId, bEmp.membershipId)).id,
        skillId: skill.id,
        managerMembershipId: bMgr.membershipId,
        employeeMembershipId: bEmp.membershipId,
      },
      managerCookie: aMgr.cookie!,
      employeeCookie: aEmp.cookie!,
    };
  });
  afterAll(async () => {
    await app?.close();
  });

  const resolve = (template: string, o: Partial<Params> = {}) => {
    const p: Params = {
      orgId: f.a.orgId,
      shiftId: f.a.shiftId,
      offerId: f.a.offerId,
      id: f.a.unavailId,
      ...o,
    };
    const real = (key: keyof Params) => {
      const v = p[key];
      if (v !== 'B' && v !== 'MGR') return v;
      if (v === 'MGR') return f.a.mgrUnavailId;
      return { orgId: f.b.orgId, shiftId: f.b.shiftId, offerId: f.b.offerId, id: f.b.unavailId }[
        key
      ];
    };
    return `/api/v1/${template
      .replace(':orgId', real('orgId'))
      .replace(':shiftId', real('shiftId'))
      .replace(':offerId', real('offerId'))
      .replace(':id', real('id'))}`;
  };

  const send = (
    row: Row,
    cookie: string | undefined,
    path: string,
    query: string | undefined,
    body: object | undefined,
  ) => {
    const [method] = row.route.split(' ');
    const client = api(app, cookie);
    const url = path + (query ?? '');
    const req = {
      GET: client.get,
      POST: client.post,
      PATCH: client.patch,
      DELETE: client.delete,
    }[method]!(url);
    return body === undefined ? req : req.send(body);
  };
  const cookieOf = (actor: Actor) => (actor === 'manager' ? f.managerCookie : f.employeeCookie);

  it('covers exactly the registered org-scoped routes', () => {
    const discovery = new DiscoveryService(app.get(ModulesContainer));
    const scanner = new MetadataScanner();
    const names: Record<number, string> = {
      [RequestMethod.GET]: 'GET',
      [RequestMethod.POST]: 'POST',
      [RequestMethod.PATCH]: 'PATCH',
      [RequestMethod.PUT]: 'PUT',
      [RequestMethod.DELETE]: 'DELETE',
    };
    const first = (v: unknown): string => (Array.isArray(v) ? (v[0] as string) : (v as string));
    const found = new Set<string>();
    for (const wrapper of discovery.getControllers()) {
      const { instance } = wrapper;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const base = first(Reflect.getMetadata(PATH_METADATA, instance.constructor)) ?? '';
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as object;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (method === undefined) continue;
        const sub = first(Reflect.getMetadata(PATH_METADATA, handler)) ?? '/';
        const path = [base, sub === '/' ? '' : sub]
          .filter(Boolean)
          .join('/')
          .replace(/\/+/g, '/')
          .replace(/^\//, '');
        if (path.startsWith('orgs/:orgId')) found.add(`${names[method] ?? method} ${path}`);
      }
    }
    expect([...found].sort()).toEqual(ROWS.map((r) => r.route).sort());
  });

  describe.each(ROWS.map((r) => [r.route, r] as const))('%s', (_route, row) => {
    const template = row.route.split(' ')[1];
    const own = (actor: Actor) => {
      const body = row.body?.(f);
      return send(row, cookieOf(actor), resolve(template), row.query, body);
    };

    it('401 without a session cookie', async () => {
      const res = await send(row, undefined, resolve(template), row.query, row.body?.(f));
      expect(res.status).toBe(401);
    });

    it("404 for another org's orgId", async () => {
      const res = await send(
        row,
        f.managerCookie,
        resolve(template, { orgId: 'B', shiftId: 'B', offerId: 'B', id: 'B' }),
        row.query,
        row.body?.(f),
      );
      expect(res.status).toBe(404);
    });

    if (row.managerOnly) {
      it('403 for an EMPLOYEE', async () => {
        expect((await own('employee')).status).toBe(403);
      });
    } else {
      it('is reachable for an EMPLOYEE (not 401/403)', async () => {
        const res = await send(
          row,
          f.employeeCookie,
          resolve(template, row.scratchOffer ? { offerId: f.a.scratchOfferId } : {}),
          row.query,
          row.body?.(f),
        );
        expect([401, 403]).not.toContain(res.status);
      });
    }

    for (const v of row.foreign) {
      it(`404 for ${v.name}`, async () => {
        const res = await send(
          row,
          cookieOf(v.actor),
          resolve(template, v.params),
          v.query ?? row.query,
          (v.body ?? row.body)?.(f),
        );
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });
    }
  });
});
