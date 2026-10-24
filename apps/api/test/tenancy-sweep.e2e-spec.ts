import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Actor = 'manager' | 'employee' | 'employee2';
type Params = {
  orgId: string;
  shiftId: string;
  offerId: string;
  id: string;
  membershipId: string;
};

/** One concrete request; built fresh (own scratch entities) by each row's `setup`. */
interface Req {
  params: Params;
  query?: string;
  body?: object;
}

interface Variant {
  name: string;
  /** Swaps exactly one org-B id into the control request. */
  mutate: (req: Req, f: Fixture) => Req;
}

interface Row {
  /** `METHOD path-template`, as registered by the controllers (without the global prefix). */
  route: string;
  /** Actor of the positive control. */
  actor: Actor;
  /** Exact status of the control request (own org, own valid ids). */
  expected: number;
  /** Rejected with 403 for an EMPLOYEE (MANAGER-only route). */
  managerOnly: boolean;
  /** Builds a fresh, valid request against org A's own entities. */
  setup: (f: Fixture) => Promise<Req>;
  foreign: Variant[];
}

interface Fixture {
  a: {
    orgId: string;
    managerId: string;
    employeeId: string;
    employee2Id: string;
    skillId: string;
    mgrUnavailId: string;
  };
  b: {
    orgId: string;
    shiftId: string;
    offerId: string;
    acceptanceId: string;
    unavailId: string;
    skillId: string;
    employeeId: string;
  };
  cookies: Record<Actor, string>;
}

const day = 24 * 3600_000;
let slotCounter = 0;
/** Fresh, far-apart 8h slot so scratch shifts never collide on overlap/rest/weekly rules. */
const nextSlot = () => {
  const start = new Date(Date.now() + (100 + slotCounter++ * 9) * day);
  return { startAt: start, endAt: new Date(start.getTime() + 8 * 3600_000) };
};
const isoSlot = () => {
  const s = nextSlot();
  return { startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString() };
};
const RANGE = `?from=${encodeURIComponent(new Date(Date.now() - day).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 10 * day).toISOString())}`;

describe('tenancy and permission sweep', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let f: Fixture;

  const base = (): Params => ({ orgId: f.a.orgId, shiftId: '', offerId: '', id: '', membershipId: '' });

  const mkPlaceholder = (withEmail: boolean) =>
    ctx.prisma.membership.create({
      data: {
        organizationId: f.a.orgId,
        displayName: 'Scratch Placeholder',
        email: withEmail ? `scratch-${Date.now()}-${slotCounter++}@shiftswap.test` : null,
        accessLevel: 'EMPLOYEE',
      },
    });
  const mkShift = (assignedMembershipId: string | null) =>
    ctx.prisma.shift.create({
      data: { organizationId: f.a.orgId, assignedMembershipId, ...nextSlot() },
    });
  const mkOffer = async (kind: 'GIVE_AWAY' | 'OPEN_SHIFT') => {
    const owner = kind === 'GIVE_AWAY' ? f.a.employeeId : null;
    const shift = await mkShift(owner);
    const offer = await ctx.prisma.offer.create({
      data: {
        organizationId: f.a.orgId,
        shiftId: shift.id,
        kind,
        originalOwnerMembershipId: owner,
        createdByMembershipId: f.a.managerId,
        expiresAt: new Date(shift.startAt.getTime() - 2 * 3600_000),
      },
    });
    return { shiftId: shift.id, offerId: offer.id };
  };
  const mkPending = (offerId: string, membershipId: string) =>
    ctx.prisma.acceptance.create({
      data: { organizationId: f.a.orgId, offerId, membershipId, status: 'PENDING' },
    });
  const offerReq = async (
    body?: (offerId: string) => object,
    kind: 'GIVE_AWAY' | 'OPEN_SHIFT' = 'GIVE_AWAY',
  ) => {
    const { offerId } = await mkOffer(kind);
    return { params: { ...base(), offerId }, body: body?.(offerId) } satisfies Req;
  };
  const swap = (fn: (req: Req, f: Fixture) => Req): Variant['mutate'] => fn;
  const offerB: Variant = {
    name: 'offerId of org B',
    mutate: swap((r, fx) => ({ ...r, params: { ...r.params, offerId: fx.b.offerId } })),
  };
  const shiftB: Variant = {
    name: 'shiftId of org B',
    mutate: swap((r, fx) => ({ ...r, params: { ...r.params, shiftId: fx.b.shiftId } })),
  };

  const ROWS: Row[] = [
    {
      route: 'GET orgs/:orgId',
      actor: 'employee',
      expected: 200,
      managerOnly: false,
      setup: async () => ({ params: base() }),
      foreign: [],
    },
    {
      route: 'GET orgs/:orgId/members',
      actor: 'manager',
      expected: 200,
      managerOnly: true,
      setup: async () => ({ params: base() }),
      foreign: [],
    },
    {
      route: 'POST orgs/:orgId/members',
      actor: 'manager',
      expected: 201,
      managerOnly: true,
      setup: async (fx) => ({
        params: base(),
        body: {
          displayName: 'Sweep Invitee',
          email: `sweep-${Date.now()}-${slotCounter++}@shiftswap.test`,
          skillIds: [fx.a.skillId],
          appOrigin: 'http://localhost:5173',
        },
      }),
      foreign: [
        {
          name: 'skillIds of org B',
          mutate: (r, fx) => ({ ...r, body: { ...r.body, skillIds: [fx.b.skillId] } }),
        },
      ],
    },
    {
      route: 'PATCH orgs/:orgId/members/:membershipId',
      actor: 'manager',
      expected: 200,
      managerOnly: true,
      setup: async (fx) => ({
        params: { ...base(), membershipId: (await mkPlaceholder(false)).id },
        body: { displayName: 'Renamed', skillIds: [fx.a.skillId] },
      }),
      foreign: [
        {
          name: 'membershipId of org B',
          mutate: (r, fx) => ({ ...r, params: { ...r.params, membershipId: fx.b.employeeId } }),
        },
        {
          name: 'skillIds of org B',
          mutate: (r, fx) => ({ ...r, body: { ...r.body, skillIds: [fx.b.skillId] } }),
        },
      ],
    },
    {
      route: 'POST orgs/:orgId/members/:membershipId/invite',
      actor: 'manager',
      expected: 201,
      managerOnly: true,
      setup: async () => ({
        params: { ...base(), membershipId: (await mkPlaceholder(true)).id },
        body: { appOrigin: 'http://localhost:5173' },
      }),
      foreign: [
        {
          name: 'membershipId of org B',
          mutate: (r, fx) => ({ ...r, params: { ...r.params, membershipId: fx.b.employeeId } }),
        },
      ],
    },
    {
      route: 'POST orgs/:orgId/members/:membershipId/deactivate',
      actor: 'manager',
      expected: 200,
      managerOnly: true,
      setup: async () => ({ params: { ...base(), membershipId: (await mkPlaceholder(false)).id } }),
      foreign: [
        {
          name: 'membershipId of org B',
          mutate: (r, fx) => ({ ...r, params: { ...r.params, membershipId: fx.b.employeeId } }),
        },
      ],
    },
    {
      route: 'POST orgs/:orgId/members/:membershipId/reactivate',
      actor: 'manager',
      expected: 200,
      managerOnly: true,
      setup: async () => {
        const m = await mkPlaceholder(false);
        await ctx.prisma.membership.update({
          where: { id: m.id },
          data: { status: 'DEACTIVATED' },
        });
        return { params: { ...base(), membershipId: m.id } };
      },
      foreign: [
        {
          name: 'membershipId of org B',
          mutate: (r, fx) => ({ ...r, params: { ...r.params, membershipId: fx.b.employeeId } }),
        },
      ],
    },
    {
      route: 'GET orgs/:orgId/skills',
      actor: 'employee',
      expected: 200,
      managerOnly: false,
      setup: async () => ({ params: base() }),
      foreign: [],
    },
    {
      route: 'GET orgs/:orgId/shifts',
      actor: 'manager',
      expected: 200,
      managerOnly: true,
      setup: async () => ({ params: base(), query: RANGE }),
      foreign: [],
    },
    {
      route: 'POST orgs/:orgId/shifts',
      actor: 'manager',
      expected: 201,
      managerOnly: true,
      setup: async (fx) => ({
        params: base(),
        body: {
          ...isoSlot(),
          requiredSkillIds: [fx.a.skillId],
          assignedMembershipId: fx.a.employee2Id,
        },
      }),
      foreign: [
        {
          name: 'requiredSkillIds of org B',
          mutate: (r, fx) => ({ ...r, body: { ...r.body, requiredSkillIds: [fx.b.skillId] } }),
        },
        {
          name: 'assignedMembershipId of org B',
          mutate: (r, fx) => ({ ...r, body: { ...r.body, assignedMembershipId: fx.b.employeeId } }),
        },
      ],
    },
    {
      route: 'PATCH orgs/:orgId/shifts/:shiftId',
      actor: 'manager',
      expected: 200,
      managerOnly: true,
      setup: async (fx) => ({
        params: { ...base(), shiftId: (await mkShift(null)).id },
        body: {
          version: 1,
          requiredSkillIds: [fx.a.skillId],
          assignedMembershipId: fx.a.employee2Id,
        },
      }),
      foreign: [
        shiftB,
        {
          name: 'requiredSkillIds of org B',
          mutate: (r, fx) => ({ ...r, body: { ...r.body, requiredSkillIds: [fx.b.skillId] } }),
        },
        {
          name: 'assignedMembershipId of org B',
          mutate: (r, fx) => ({ ...r, body: { ...r.body, assignedMembershipId: fx.b.employeeId } }),
        },
      ],
    },
    {
      route: 'DELETE orgs/:orgId/shifts/:shiftId',
      actor: 'manager',
      expected: 204,
      managerOnly: true,
      setup: async () => ({
        params: { ...base(), shiftId: (await mkShift(null)).id },
        query: '?version=1',
      }),
      foreign: [shiftB],
    },
    {
      route: 'GET orgs/:orgId/me/unavailability',
      actor: 'employee',
      expected: 200,
      managerOnly: false,
      setup: async () => ({ params: base() }),
      foreign: [],
    },
    {
      route: 'POST orgs/:orgId/me/unavailability',
      actor: 'employee',
      expected: 201,
      managerOnly: false,
      setup: async () => ({ params: base(), body: isoSlot() }),
      foreign: [],
    },
    {
      route: 'DELETE orgs/:orgId/me/unavailability/:id',
      actor: 'employee',
      expected: 204,
      managerOnly: false,
      setup: async (fx) => ({
        params: {
          ...base(),
          id: (
            await ctx.prisma.unavailability.create({
              data: { organizationId: fx.a.orgId, membershipId: fx.a.employeeId, ...nextSlot() },
            })
          ).id,
        },
      }),
      foreign: [
        {
          name: 'unavailability id of org B',
          mutate: (r, fx) => ({ ...r, params: { ...r.params, id: fx.b.unavailId } }),
        },
        {
          name: 'unavailability id of a colleague',
          mutate: (r, fx) => ({ ...r, params: { ...r.params, id: fx.a.mgrUnavailId } }),
        },
      ],
    },
    {
      route: 'POST orgs/:orgId/offers',
      actor: 'employee',
      expected: 201,
      managerOnly: false,
      setup: async (fx) => ({
        params: base(),
        body: { shiftId: (await mkShift(fx.a.employeeId)).id, kind: 'GIVE_AWAY' },
      }),
      foreign: [
        {
          name: 'shiftId of org B',
          mutate: (r, fx) => ({ ...r, body: { ...r.body, shiftId: fx.b.shiftId } }),
        },
      ],
    },
    {
      route: 'GET orgs/:orgId/offers',
      actor: 'employee',
      expected: 200,
      managerOnly: false,
      setup: async () => ({ params: base(), query: '?scope=mine' }),
      foreign: [],
    },
    {
      route: 'GET orgs/:orgId/offers/:offerId',
      actor: 'manager',
      expected: 200,
      managerOnly: false,
      setup: () => offerReq(),
      foreign: [offerB],
    },
    {
      route: 'POST orgs/:orgId/offers/:offerId/cancel',
      actor: 'employee',
      expected: 200,
      managerOnly: false,
      setup: () => offerReq(() => ({ version: 1 })),
      foreign: [offerB],
    },
    {
      route: 'POST orgs/:orgId/offers/:offerId/acceptances',
      actor: 'employee2',
      expected: 201,
      managerOnly: false,
      setup: () => offerReq(),
      foreign: [offerB],
    },
    {
      route: 'DELETE orgs/:orgId/offers/:offerId/acceptances/me',
      actor: 'employee2',
      expected: 204,
      managerOnly: false,
      setup: async (fx) => {
        const req = await offerReq();
        await mkPending(req.params.offerId, fx.a.employee2Id);
        return req;
      },
      foreign: [offerB],
    },
    {
      route: 'POST orgs/:orgId/offers/:offerId/claim',
      actor: 'employee2',
      expected: 200,
      managerOnly: false,
      setup: () => offerReq(undefined, 'OPEN_SHIFT'),
      foreign: [offerB],
    },
    {
      route: 'POST orgs/:orgId/offers/:offerId/approve',
      actor: 'manager',
      expected: 200,
      managerOnly: true,
      setup: async (fx) => {
        const req = await offerReq();
        const acc = await mkPending(req.params.offerId, fx.a.employee2Id);
        return { ...req, body: { acceptanceId: acc.id, version: 1 } };
      },
      foreign: [
        offerB,
        {
          name: 'acceptanceId of org B on own offer',
          mutate: (r, fx) => ({ ...r, body: { ...r.body, acceptanceId: fx.b.acceptanceId } }),
        },
      ],
    },
    {
      route: 'POST orgs/:orgId/offers/:offerId/reject',
      actor: 'manager',
      expected: 200,
      managerOnly: true,
      setup: () => offerReq(() => ({ version: 1 })),
      foreign: [offerB],
    },
    {
      route: 'GET orgs/:orgId/notifications',
      actor: 'employee',
      expected: 200,
      managerOnly: false,
      setup: async () => ({ params: base(), query: '?limit=5' }),
      foreign: [],
    },
    {
      route: 'GET orgs/:orgId/notifications/unread-count',
      actor: 'employee',
      expected: 200,
      managerOnly: false,
      setup: async () => ({ params: base() }),
      foreign: [],
    },
    {
      route: 'POST orgs/:orgId/notifications/read',
      actor: 'employee',
      expected: 204,
      managerOnly: false,
      setup: async () => ({ params: base(), body: {} }),
      foreign: [],
    },
  ];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { prisma } = ctx;
    const orgA = await makeOrg(prisma);
    const orgB = await makeOrg(prisma);
    const aMgr = await makeMember(ctx, orgA.orgId, { accessLevel: 'MANAGER' });
    const aEmp = await makeMember(ctx, orgA.orgId, { accessLevel: 'EMPLOYEE' });
    const aEmp2 = await makeMember(ctx, orgA.orgId, { accessLevel: 'EMPLOYEE' });
    const bMgr = await makeMember(ctx, orgB.orgId, { accessLevel: 'MANAGER' });
    const bEmp = await makeMember(ctx, orgB.orgId, {
      accessLevel: 'EMPLOYEE',
      skillNames: ['Kitchen'],
    });
    const bSkill = await prisma.skill.findFirstOrThrow({ where: { organizationId: orgB.orgId } });
    const aSkill = await prisma.skill.create({
      data: { organizationId: orgA.orgId, name: 'Bar' },
    });

    const bShift = await prisma.shift.create({
      data: { organizationId: orgB.orgId, assignedMembershipId: bEmp.membershipId, ...nextSlot() },
    });
    const bOffer = await prisma.offer.create({
      data: {
        organizationId: orgB.orgId,
        shiftId: bShift.id,
        kind: 'GIVE_AWAY',
        originalOwnerMembershipId: bEmp.membershipId,
        createdByMembershipId: bEmp.membershipId,
        expiresAt: new Date(bShift.startAt.getTime() - 2 * 3600_000),
      },
    });
    const bAcc = await prisma.acceptance.create({
      data: {
        organizationId: orgB.orgId,
        offerId: bOffer.id,
        membershipId: bMgr.membershipId,
        status: 'PENDING',
      },
    });
    const un = (orgId: string, membershipId: string) =>
      prisma.unavailability.create({
        data: { organizationId: orgId, membershipId, ...nextSlot() },
      });

    f = {
      a: {
        orgId: orgA.orgId,
        managerId: aMgr.membershipId,
        employeeId: aEmp.membershipId,
        employee2Id: aEmp2.membershipId,
        skillId: aSkill.id,
        mgrUnavailId: (await un(orgA.orgId, aMgr.membershipId)).id,
      },
      b: {
        orgId: orgB.orgId,
        shiftId: bShift.id,
        offerId: bOffer.id,
        acceptanceId: bAcc.id,
        unavailId: (await un(orgB.orgId, bEmp.membershipId)).id,
        skillId: bSkill.id,
        employeeId: bEmp.membershipId,
      },
      cookies: { manager: aMgr.cookie!, employee: aEmp.cookie!, employee2: aEmp2.cookie! },
    };
  });
  afterAll(async () => {
    await app?.close();
  });

  const send = (row: Row, cookie: string | undefined, req: Req) => {
    const [method, template] = row.route.split(' ');
    const path = template
      .replace(':orgId', req.params.orgId)
      .replace(':shiftId', req.params.shiftId)
      .replace(':offerId', req.params.offerId)
      .replace(':membershipId', req.params.membershipId)
      .replace(':id', req.params.id);
    const client = api(app, cookie);
    const call = {
      GET: client.get,
      POST: client.post,
      PATCH: client.patch,
      DELETE: client.delete,
    }[method]!(`/api/v1/${path}${req.query ?? ''}`);
    return req.body === undefined ? call : call.send(req.body);
  };

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
    const all = new Set<string>();
    for (const wrapper of discovery.getControllers()) {
      const { instance } = wrapper;
      if (!instance) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const prefix = first(Reflect.getMetadata(PATH_METADATA, instance.constructor)) ?? '';
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as object;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (method === undefined) continue;
        const sub = first(Reflect.getMetadata(PATH_METADATA, handler)) ?? '/';
        const path = [prefix, sub === '/' ? '' : sub]
          .filter(Boolean)
          .join('/')
          .replace(/\/+/g, '/')
          .replace(/^\//, '');
        all.add(`${names[method] ?? method} ${path}`);
      }
    }
    // `POST orgs` (create an organisation) is session-only: there is no org yet to scope to.
    // `invites/:token` routes are keyed by an unguessable token, not an org: exact routes only.
    const isPublic = (route: string) =>
      /^([A-Z]+ (me|health)(\/|$)|POST orgs$|GET invites\/:token$|POST invites\/:token\/accept$)/.test(
        route,
      );
    const protectedRoutes = [...all].filter((r) => !isPublic(r));
    // Any other route must live under orgs/:orgId, so a renamed param cannot escape the sweep.
    expect(protectedRoutes.filter((r) => !/^[A-Z]+ orgs\/:orgId(\/|$)/.test(r))).toEqual([]);
    expect(protectedRoutes.sort()).toEqual(ROWS.map((r) => r.route).sort());
  });

  describe.each(ROWS.map((r) => [r.route, r] as const))('%s', (_route, row) => {
    it('control: own-org ids succeed with the exact expected status', async () => {
      const res = await send(row, f.cookies[row.actor], await row.setup(f));
      expect(res.status).toBe(row.expected);
    });

    it('401 without a session cookie', async () => {
      expect((await send(row, undefined, await row.setup(f))).status).toBe(401);
    });

    it("404 for another org's orgId (only orgId swapped)", async () => {
      const req = await row.setup(f);
      const res = await send(row, f.cookies[row.actor], {
        ...req,
        params: { ...req.params, orgId: f.b.orgId },
      });
      expect(res.status).toBe(404);
    });

    if (row.managerOnly) {
      it('403 for an EMPLOYEE on a MANAGER route', async () => {
        expect((await send(row, f.cookies.employee, await row.setup(f))).status).toBe(403);
      });
    }

    for (const v of row.foreign) {
      it(`404 NOT_FOUND for ${v.name} (paired control succeeds)`, async () => {
        const control = await send(row, f.cookies[row.actor], await row.setup(f));
        expect(control.status).toBe(row.expected);
        const res = await send(row, f.cookies[row.actor], v.mutate(await row.setup(f), f));
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });
    }
  });
});
