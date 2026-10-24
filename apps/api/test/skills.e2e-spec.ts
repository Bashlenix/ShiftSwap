import type { INestApplication } from '@nestjs/common';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

type Member = { membershipId: string; cookie?: string };

const hour = 3600_000;
const day = 24 * hour;

describe('skills catalogue (FR-03)', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let admin: Member;
  let manager: Member;
  let employee: Member;
  let n = 0;

  const url = (p = '') => `/api/v1/orgs/${orgId}/skills${p}`;
  const create = (name: string, actor: Member = admin) =>
    api(app, actor.cookie).post(url()).send({ name });
  const shiftWith = async (skillId: string, startOffsetMs: number, deleted = false) =>
    ctx.prisma.shift.create({
      data: {
        organizationId: orgId,
        startAt: new Date(Date.now() + startOffsetMs),
        endAt: new Date(Date.now() + startOffsetMs + 4 * hour),
        deletedAt: deleted ? new Date() : null,
        skills: { create: [{ skillId }] },
      },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    ({ orgId } = await makeOrg(ctx.prisma));
    admin = await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    manager = await makeMember(ctx, orgId, { accessLevel: 'MANAGER' });
    employee = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('GET lists the org skills sorted by name for any member', async () => {
    await create(`Zeta ${n++}`);
    await create(`Alpha ${n++}`);
    const res = await api(app, employee.cookie).get(url());
    expect(res.status).toBe(200);
    const names = (res.body as { id: string; name: string }[]).map((s) => s.name);
    expect(names).toEqual([...names].sort());
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('POST creates a skill (ADMIN only) and audits it', async () => {
    const res = await create(`  Barista ${n++}  `);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), name: `Barista ${n - 1}` });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: 'skill.created', entityId: res.body.id },
    });
    expect(audit).not.toBeNull();

    expect((await create(`Mgr ${n++}`, manager)).status).toBe(403);
    expect((await create(`Emp ${n++}`, employee)).status).toBe(403);
    const blank = await create('   ');
    expect(blank.status).toBe(400);
    expect(blank.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('POST with a duplicate name (case-insensitive) -> 409 VALIDATION_FAILED', async () => {
    const name = `Kitchen ${n++}`;
    expect((await create(name)).status).toBe(201);
    for (const dup of [name, name.toUpperCase(), ` ${name.toLowerCase()} `]) {
      const res = await create(dup);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.message).toBe('A skill with this name already exists');
    }
  });

  it('PATCH renames (ADMIN only); duplicate -> 409; unknown or foreign id -> 404', async () => {
    const a = (await create(`Grill ${n++}`)).body;
    const b = (await create(`Fryer ${n++}`)).body;
    const res = await api(app, admin.cookie)
      .patch(url(`/${a.id}`))
      .send({ name: `Grill X ${n}` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: a.id, name: `Grill X ${n}` });

    const dup = await api(app, admin.cookie)
      .patch(url(`/${a.id}`))
      .send({ name: b.name.toLowerCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('VALIDATION_FAILED');
    expect(dup.body.error.message).toBe('A skill with this name already exists');

    // Renaming to its own name in another case is fine.
    const self = await api(app, admin.cookie)
      .patch(url(`/${b.id}`))
      .send({ name: b.name.toUpperCase() });
    expect(self.status).toBe(200);

    expect(
      (
        await api(app, manager.cookie)
          .patch(url(`/${a.id}`))
          .send({ name: 'Nope' })
      ).status,
    ).toBe(403);
    const unknown = await api(app, admin.cookie)
      .patch(url('/00000000-0000-4000-8000-000000000000'))
      .send({ name: 'Nope' });
    expect(unknown.status).toBe(404);
    const other = (await makeOrg(ctx.prisma)).orgId;
    const foreign = await ctx.prisma.skill.create({ data: { organizationId: other, name: 'Bar' } });
    expect(
      (
        await api(app, admin.cookie)
          .patch(url(`/${foreign.id}`))
          .send({ name: 'Mine' })
      ).status,
    ).toBe(404);
    expect((await api(app, admin.cookie).delete(url(`/${foreign.id}`))).status).toBe(404);
  });

  it('DELETE a skill required by future shifts -> 409 SKILL_IN_USE with shiftCount', async () => {
    const skill = (await create(`Cashier ${n++}`)).body;
    await shiftWith(skill.id, 2 * day);
    await shiftWith(skill.id, 5 * day);
    await shiftWith(skill.id, -2 * day); // past: does not count
    await shiftWith(skill.id, 3 * day, true); // deleted: does not count

    const res = await api(app, admin.cookie).delete(url(`/${skill.id}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SKILL_IN_USE');
    expect(res.body.error.details).toEqual({ shiftCount: 2 });
    expect(await ctx.prisma.skill.count({ where: { id: skill.id } })).toBe(1);
  });

  it('DELETE an unused skill -> 204, join rows cascade (ADMIN only)', async () => {
    const skill = (await create(`Dishwasher ${n++}`)).body;
    const past = await shiftWith(skill.id, -3 * day);
    await ctx.prisma.membershipSkill.create({
      data: { membershipId: employee.membershipId, skillId: skill.id },
    });

    expect((await api(app, manager.cookie).delete(url(`/${skill.id}`))).status).toBe(403);
    const res = await api(app, admin.cookie).delete(url(`/${skill.id}`));
    expect(res.status).toBe(204);
    expect(await ctx.prisma.skill.count({ where: { id: skill.id } })).toBe(0);
    expect(await ctx.prisma.shiftSkill.count({ where: { skillId: skill.id } })).toBe(0);
    expect(await ctx.prisma.membershipSkill.count({ where: { skillId: skill.id } })).toBe(0);
    expect(await ctx.prisma.shift.count({ where: { id: past.id } })).toBe(1);
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: 'skill.deleted', entityId: skill.id },
    });
    expect(audit).not.toBeNull();
    expect((await api(app, admin.cookie).delete(url(`/${skill.id}`))).status).toBe(404);
  });

  it('deleting a skill while a shift PATCH adds it: never 500 (x5)', async () => {
    for (let i = 0; i < 5; i++) {
      const skill = (await create(`Race Shift ${n++}`)).body;
      const shift = await ctx.prisma.shift.create({
        data: {
          organizationId: orgId,
          startAt: new Date(Date.now() + (20 + i) * day),
          endAt: new Date(Date.now() + (20 + i) * day + 4 * hour),
        },
      });
      const [patch, del] = await Promise.all([
        api(app, manager.cookie)
          .patch(`/api/v1/orgs/${orgId}/shifts/${shift.id}`)
          .send({ version: 1, requiredSkillIds: [skill.id] }),
        new Promise((r) => setTimeout(r, i * 3)).then(() =>
          api(app, admin.cookie).delete(url(`/${skill.id}`)),
        ),
      ]);
      if (del.status === 204) {
        expect(patch.status).toBe(404);
        expect(await ctx.prisma.shiftSkill.count({ where: { shiftId: shift.id } })).toBe(0);
      } else {
        expect(patch.status).toBe(200);
        expect(del.status).toBe(409);
        expect(del.body.error).toMatchObject({ code: 'SKILL_IN_USE', details: { shiftCount: 1 } });
      }
    }
  });

  it('a shift PATCH moving times without requiredSkillIds waits for a skill delete holding the skill lock', async () => {
    const skill = (await create(`Race Move ${n++}`)).body;
    // Past shift requiring the skill: a delete alone would be allowed (no future shift needs it).
    const shift = await ctx.prisma.shift.create({
      data: {
        organizationId: orgId,
        startAt: new Date(Date.now() - 3 * day),
        endAt: new Date(Date.now() - 3 * day + 4 * hour),
        skills: { create: [{ skillId: skill.id }] },
      },
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((r) => (locked = r));
    // Same row lock a skill delete takes (FOR UPDATE on the skill row).
    const holder = ctx.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "skills" WHERE id = ${skill.id} FOR UPDATE`;
        locked();
        await gate;
      },
      { timeout: 15_000 },
    );
    await isLocked;
    let done = false;
    const patch = api(app, manager.cookie)
      .patch(`/api/v1/orgs/${orgId}/shifts/${shift.id}`)
      .send({
        version: 1,
        startAt: new Date(Date.now() + 30 * day).toISOString(),
        endAt: new Date(Date.now() + 30 * day + 4 * hour).toISOString(),
      })
      .then((r) => {
        done = true;
        return r;
      });
    await new Promise((r) => setTimeout(r, 500));
    expect(done).toBe(false);
    release();
    await holder;
    const res = await patch;
    expect(res.status).toBe(200);
    expect(res.body.shift.requiredSkillIds).toEqual([skill.id]);
    // Now the shift is in the future and still requires the skill: delete is refused.
    const del = await api(app, admin.cookie).delete(url(`/${skill.id}`));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('SKILL_IN_USE');
  });

  it('deleting a skill while a member PATCH adds it: never 500 (x5)', async () => {
    for (let i = 0; i < 5; i++) {
      const skill = (await create(`Race Member ${n++}`)).body;
      const [patch, del] = await Promise.all([
        api(app, manager.cookie)
          .patch(`/api/v1/orgs/${orgId}/members/${employee.membershipId}`)
          .send({ skillIds: [skill.id] }),
        new Promise((r) => setTimeout(r, i * 3)).then(() =>
          api(app, admin.cookie).delete(url(`/${skill.id}`)),
        ),
      ]);
      // Member skills never block a delete; the join row cascades either way.
      expect(del.status).toBe(204);
      expect([200, 404]).toContain(patch.status);
      expect(await ctx.prisma.membershipSkill.count({ where: { skillId: skill.id } })).toBe(0);
    }
  });
});
