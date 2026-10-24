import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app.factory';
import { MailService } from '../src/mail/mail.service';
import { api, createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

describe('members API (FR-02, FR-03)', () => {
  let ctx: TestCtx;
  let app: INestApplication;
  let orgId: string;
  let admin: { membershipId: string; cookie?: string };
  let manager: { membershipId: string; cookie?: string };
  let employee: { membershipId: string; cookie?: string };
  const url = (suffix = '') => `/api/v1/orgs/${orgId}/members${suffix}`;
  const mail = () => app.get(MailService);
  let n = 0;
  const email = () => `New.Person-${Date.now()}-${n++}@Shiftswap.test`;
  const tokenOf = (text: string) => /\/invites\/([A-Za-z0-9_-]{43})/.exec(text)![1];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    ({ orgId } = await makeOrg(ctx.prisma, { name: 'Cafe Nord' }));
    admin = await makeMember(ctx, orgId, { accessLevel: 'ADMIN' });
    manager = await makeMember(ctx, orgId, { accessLevel: 'MANAGER' });
    employee = await makeMember(ctx, orgId, { accessLevel: 'EMPLOYEE' });
  });
  afterAll(async () => {
    await app?.close();
  });

  it('creates a placeholder without email', async () => {
    const res = await api(app, manager.cookie).post(url()).send({ displayName: 'Pia Placeholder' });
    expect(res.status).toBe(201);
    expect(res.body.inviteLink).toBeNull();
    expect(res.body.member).toMatchObject({
      displayName: 'Pia Placeholder',
      email: null,
      hasLogin: false,
      invitePending: false,
      accessLevel: 'EMPLOYEE',
      status: 'ACTIVE',
    });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: 'member.created', entityId: res.body.member.id },
    });
    expect(audit).not.toBeNull();
  });

  it('invites by email: one mail with the link and expiry; link in response; no raw token in DB', async () => {
    const before = mail().sent.length;
    const addr = email();
    const res = await api(app, manager.cookie)
      .post(url())
      .send({ displayName: 'Ina Invitee', email: addr });
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({
      email: addr.toLowerCase(),
      invitePending: true,
      hasLogin: false,
    });
    const link: string = res.body.inviteLink;
    expect(link).toMatch(/^http:\/\/localhost:5173\/invites\/[A-Za-z0-9_-]{43}$/);

    const sent = mail().sent.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(addr.toLowerCase());
    expect(sent[0].subject).toBe("You're invited to Cafe Nord on ShiftSwap");
    expect(sent[0].text).toContain(link);
    expect(sent[0].html).toContain(link);
    expect(sent[0].text).toMatch(/This link expires on \d{1,2} [A-Z][a-z]{2} \d{4}/);

    const token = tokenOf(link);
    const invites =
      await ctx.prisma.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM "invites"');
    expect(JSON.stringify(invites)).not.toContain(token);
    const invite = await ctx.prisma.invite.findFirstOrThrow({
      where: { membershipId: res.body.member.id },
    });
    expect(invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      Math.abs(invite.expiresAt.getTime() - invite.createdAt.getTime() - 7 * 86400_000),
    ).toBeLessThan(5000);

    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { organizationId: orgId, action: 'invite.created' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toEqual({ membershipId: res.body.member.id });
    expect(JSON.stringify([audit.metadata, audit.before, audit.after])).not.toContain(token);
  });

  it('ignores an untrusted appOrigin and uses a trusted Codespace one', async () => {
    const evil = await api(app, manager.cookie)
      .post(url())
      .send({ displayName: 'E1', email: email(), appOrigin: 'https://evil.example' });
    expect(evil.status).toBe(201);
    expect(evil.body.inviteLink).toMatch(/^http:\/\/localhost:5173\/invites\//);

    const env: NodeJS.ProcessEnv = { ...process.env, ALLOW_CODESPACE_ORIGINS: 'true' };
    delete env.CODESPACE_NAME;
    delete env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
    const csApp = await createApp({ env });
    await csApp.init();
    try {
      const origin = 'https://my-space-5173.app.github.dev';
      const res = await api(csApp, manager.cookie)
        .post(url())
        .send({ displayName: 'E2', email: email(), appOrigin: origin });
      expect(res.status).toBe(201);
      expect(res.body.inviteLink).toMatch(
        /^https:\/\/my-space-5173\.app\.github\.dev\/invites\/[A-Za-z0-9_-]{43}$/,
      );
    } finally {
      await csApp.close();
    }
  });

  it('409 ALREADY_MEMBER for an active duplicate email (case-insensitive) and a deactivated one', async () => {
    const addr = email();
    const first = await api(app, manager.cookie)
      .post(url())
      .send({ displayName: 'D1', email: addr });
    expect(first.status).toBe(201);
    const mailsBefore = mail().sent.length;
    const dup = await api(app, manager.cookie)
      .post(url())
      .send({ displayName: 'D2', email: addr.toUpperCase() });
    expect(dup.status).toBe(409);
    expect(mail().sent).toHaveLength(mailsBefore);
    expect(dup.body.error.code).toBe('ALREADY_MEMBER');

    await ctx.prisma.membership.update({
      where: { id: first.body.member.id },
      data: { status: 'DEACTIVATED' },
    });
    const again = await api(app, manager.cookie)
      .post(url())
      .send({ displayName: 'D3', email: addr });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_MEMBER');
    expect(again.body.error.message).toBe('This person was deactivated — reactivate them instead.');
  });

  it('403 for an employee; 403 for a manager creating an ADMIN; ADMIN may', async () => {
    const asEmp = await api(app, employee.cookie).post(url()).send({ displayName: 'X' });
    expect(asEmp.status).toBe(403);
    const mailsBefore = mail().sent.length;
    const mgr = await api(app, manager.cookie)
      .post(url())
      .send({ displayName: 'X', accessLevel: 'ADMIN', email: email() });
    expect(mgr.status).toBe(403);
    expect(mail().sent).toHaveLength(mailsBefore);
    const adm = await api(app, admin.cookie)
      .post(url())
      .send({ displayName: 'Ada Admin', accessLevel: 'ADMIN' });
    expect(adm.status).toBe(201);
    expect(adm.body.member.accessLevel).toBe('ADMIN');
  });

  it('404 for a foreign skill id', async () => {
    const other = await makeOrg(ctx.prisma);
    const foreign = await ctx.prisma.skill.create({
      data: { organizationId: other.orgId, name: 'Foreign' },
    });
    const res = await api(app, manager.cookie)
      .post(url())
      .send({ displayName: 'S', skillIds: [foreign.id] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('400 VALIDATION_FAILED for an unknown status filter', async () => {
    const res = await api(app, manager.cookie).get(url('?status=bogus'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('status=deactivated lists only deactivated members; ?status=foo is 400', async () => {
    const { orgId: o } = await makeOrg(ctx.prisma);
    const m = await makeMember(ctx, o, { accessLevel: 'MANAGER', name: 'Zed' });
    const base = `/api/v1/orgs/${o}/members`;
    const gone = await api(app, m.cookie).post(base).send({ displayName: 'Abe' });
    await ctx.prisma.membership.update({
      where: { id: gone.body.member.id },
      data: { status: 'DEACTIVATED' },
    });
    const res = await api(app, m.cookie).get(`${base}?status=deactivated`);
    expect(res.status).toBe(200);
    expect(res.body.map((x: { displayName: string }) => x.displayName)).toEqual(['Abe']);
    const bad = await api(app, m.cookie).get(`${base}?status=foo`);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('lists members sorted by name with invitePending; status filter', async () => {
    const { orgId: o } = await makeOrg(ctx.prisma);
    const m = await makeMember(ctx, o, { accessLevel: 'MANAGER', name: 'Zed' });
    const base = `/api/v1/orgs/${o}/members`;
    await api(app, m.cookie).post(base).send({ displayName: 'Bea', email: email() });
    const gone = await api(app, m.cookie).post(base).send({ displayName: 'Abe' });
    await ctx.prisma.membership.update({
      where: { id: gone.body.member.id },
      data: { status: 'DEACTIVATED' },
    });
    const active = await api(app, m.cookie).get(base);
    expect(active.status).toBe(200);
    expect(active.body.map((x: { displayName: string }) => x.displayName)).toEqual(['Bea', 'Zed']);
    expect(active.body[0].invitePending).toBe(true);
    expect(active.body[1].invitePending).toBe(false);
    const all = await api(app, m.cookie).get(`${base}?status=all`);
    expect(all.body.map((x: { displayName: string }) => x.displayName)).toEqual([
      'Abe',
      'Bea',
      'Zed',
    ]);
    // an expired invite is not pending
    const bea = active.body[0].id as string;
    await ctx.prisma.invite.updateMany({
      where: { membershipId: bea },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const after = await api(app, m.cookie).get(base);
    expect(after.body[0].invitePending).toBe(false);
  });

  describe('PATCH', () => {
    it('updates name, limit and replaces skills; audits', async () => {
      const s1 = await ctx.prisma.skill.create({
        data: { organizationId: orgId, name: `S1-${n++}` },
      });
      const s2 = await ctx.prisma.skill.create({
        data: { organizationId: orgId, name: `S2-${n++}` },
      });
      const c = await api(app, manager.cookie)
        .post(url())
        .send({ displayName: 'Pat', skillIds: [s1.id] });
      const id = c.body.member.id;
      const res = await api(app, manager.cookie)
        .patch(url(`/${id}`))
        .send({ displayName: 'Patricia', weeklyLimitMin: 1200, skillIds: [s2.id] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        displayName: 'Patricia',
        weeklyLimitMin: 1200,
        skillIds: [s2.id],
      });
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'member.updated', entityId: id } }),
      ).toBe(1);
    });

    it('a PATCH that changes nothing writes no audit row', async () => {
      const sk = await ctx.prisma.skill.create({
        data: { organizationId: orgId, name: `S3-${n++}` },
      });
      const c = await api(app, manager.cookie)
        .post(url())
        .send({ displayName: 'Same', weeklyLimitMin: 600, skillIds: [sk.id] });
      const id = c.body.member.id;
      const res = await api(app, manager.cookie)
        .patch(url(`/${id}`))
        .send({
          displayName: 'Same',
          accessLevel: c.body.member.accessLevel,
          weeklyLimitMin: 600,
          skillIds: [sk.id],
        });
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Same');
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'member.updated', entityId: id } }),
      ).toBe(0);
    });

    it('foreign skill or foreign membership -> 404; skills unchanged on failure', async () => {
      const other = await makeOrg(ctx.prisma);
      const foreignSkill = await ctx.prisma.skill.create({
        data: { organizationId: other.orgId, name: 'F' },
      });
      const foreignMember = await makeMember(ctx, other.orgId, { accessLevel: 'EMPLOYEE' });
      const mine = await api(app, manager.cookie).post(url()).send({ displayName: 'Q' });
      const bad = await api(app, manager.cookie)
        .patch(url(`/${mine.body.member.id}`))
        .send({ displayName: 'Changed', skillIds: [foreignSkill.id] });
      expect(bad.status).toBe(404);
      const unchanged = await ctx.prisma.membership.findUniqueOrThrow({
        where: { id: mine.body.member.id },
      });
      expect(unchanged.displayName).toBe('Q');
      expect(
        await ctx.prisma.membershipSkill.count({ where: { membershipId: mine.body.member.id } }),
      ).toBe(0);
      const other404 = await api(app, manager.cookie)
        .patch(url(`/${foreignMember.membershipId}`))
        .send({ displayName: 'Hax' });
      expect(other404.status).toBe(404);
    });

    it('access level changes need ADMIN', async () => {
      const res = await api(app, manager.cookie)
        .patch(url(`/${employee.membershipId}`))
        .send({ accessLevel: 'MANAGER' });
      expect(res.status).toBe(403);
      const ok = await api(app, admin.cookie)
        .patch(url(`/${employee.membershipId}`))
        .send({ accessLevel: 'MANAGER' });
      expect(ok.status).toBe(200);
      await api(app, admin.cookie)
        .patch(url(`/${employee.membershipId}`))
        .send({ accessLevel: 'EMPLOYEE' });
    });

    it('a manager cannot promote themselves or demote an admin', async () => {
      const self = await api(app, manager.cookie)
        .patch(url(`/${manager.membershipId}`))
        .send({ accessLevel: 'ADMIN' });
      expect(self.status).toBe(403);
      const demote = await api(app, manager.cookie)
        .patch(url(`/${admin.membershipId}`))
        .send({ accessLevel: 'EMPLOYEE' });
      expect(demote.status).toBe(403);
    });

    it('two admins demoting each other in parallel: exactly one wins, never a 500', async () => {
      for (let round = 0; round < 5; round++) {
        const { orgId: o } = await makeOrg(ctx.prisma);
        const a = await makeMember(ctx, o, { accessLevel: 'ADMIN' });
        const b = await makeMember(ctx, o, { accessLevel: 'ADMIN' });
        const patch = (cookie: string | undefined, id: string) =>
          api(app, cookie)
            .patch(`/api/v1/orgs/${o}/members/${id}`)
            .send({ accessLevel: 'MANAGER' });
        const res = await Promise.all([
          patch(a.cookie, b.membershipId),
          patch(b.cookie, a.membershipId),
        ]);
        expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(res.find((r) => r.status === 409)!.body.error.code).toBe('LAST_ADMIN');
      }
    });

    it('with three admins both parallel demotions succeed', async () => {
      const { orgId: o } = await makeOrg(ctx.prisma);
      const a = await makeMember(ctx, o, { accessLevel: 'ADMIN' });
      const b = await makeMember(ctx, o, { accessLevel: 'ADMIN' });
      await makeMember(ctx, o, { accessLevel: 'ADMIN' });
      const patch = (cookie: string | undefined, id: string) =>
        api(app, cookie).patch(`/api/v1/orgs/${o}/members/${id}`).send({ accessLevel: 'MANAGER' });
      const res = await Promise.all([
        patch(a.cookie, b.membershipId),
        patch(b.cookie, a.membershipId),
      ]);
      expect(res.map((r) => r.status)).toEqual([200, 200]);
    });

    it('409 LAST_ADMIN when demoting the only active admin', async () => {
      const { orgId: o } = await makeOrg(ctx.prisma);
      const solo = await makeMember(ctx, o, { accessLevel: 'ADMIN' });
      const res = await api(app, solo.cookie)
        .patch(`/api/v1/orgs/${o}/members/${solo.membershipId}`)
        .send({ accessLevel: 'MANAGER' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_ADMIN');
      const second = await makeMember(ctx, o, { accessLevel: 'ADMIN' });
      const ok = await api(app, solo.cookie)
        .patch(`/api/v1/orgs/${o}/members/${second.membershipId}`)
        .send({ accessLevel: 'MANAGER' });
      expect(ok.status).toBe(200);
    });
  });

  describe('resend', () => {
    it('revokes old invites, creates a new one, mails it', async () => {
      const addr = email();
      const c = await api(app, manager.cookie).post(url()).send({ displayName: 'R', email: addr });
      const oldHash = (
        await ctx.prisma.invite.findFirstOrThrow({ where: { membershipId: c.body.member.id } })
      ).tokenHash;
      const before = mail().sent.length;
      const res = await api(app, manager.cookie)
        .post(url(`/${c.body.member.id}/invite`))
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.inviteLink).toMatch(/\/invites\/[A-Za-z0-9_-]{43}$/);
      expect(res.body.inviteLink).not.toBe(c.body.inviteLink);
      const invites = await ctx.prisma.invite.findMany({
        where: { membershipId: c.body.member.id },
      });
      expect(invites).toHaveLength(2);
      expect(invites.find((i) => i.tokenHash === oldHash)!.revokedAt).not.toBeNull();
      expect(invites.filter((i) => i.revokedAt === null)).toHaveLength(1);
      const sent = mail().sent.slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0].text).toContain(res.body.inviteLink);
    });

    it('409 INVALID_TRANSITION for a placeholder without email or a member with a login', async () => {
      const ph = await api(app, manager.cookie).post(url()).send({ displayName: 'NoMail' });
      const r1 = await api(app, manager.cookie)
        .post(url(`/${ph.body.member.id}/invite`))
        .send({});
      expect(r1.status).toBe(409);
      expect(r1.body.error.code).toBe('INVALID_TRANSITION');
      const r2 = await api(app, manager.cookie)
        .post(url(`/${employee.membershipId}/invite`))
        .send({});
      expect(r2.status).toBe(409);
      expect(r2.body.error.code).toBe('INVALID_TRANSITION');
    });

    describe('with an email for a placeholder (FR-03)', () => {
      it('invites a placeholder created without email (Paul Weber pattern)', async () => {
        const ph = await api(app, manager.cookie).post(url()).send({ displayName: 'Paul W' });
        const addr = email();
        const before = mail().sent.length;
        const res = await api(app, manager.cookie)
          .post(url(`/${ph.body.member.id}/invite`))
          .send({ email: `  ${addr}  ` });
        expect(res.status).toBe(201);
        expect(res.body.inviteLink).toMatch(/\/invites\/[A-Za-z0-9_-]{43}$/);
        const m = await ctx.prisma.membership.findUniqueOrThrow({
          where: { id: ph.body.member.id },
        });
        expect(m.email).toBe(addr.toLowerCase());
        const invite = await ctx.prisma.invite.findFirstOrThrow({
          where: { membershipId: ph.body.member.id },
        });
        expect(invite.email).toBe(addr.toLowerCase());
        const sent = mail().sent.slice(before);
        expect(sent).toHaveLength(1);
        expect(sent[0].to).toBe(addr.toLowerCase());
        const list = await api(app, manager.cookie).get(url());
        expect(list.body.find((x: { id: string }) => x.id === ph.body.member.id)).toMatchObject({
          email: addr.toLowerCase(),
          invitePending: true,
        });
      });

      it('changes the address of a pending placeholder and revokes the old invite', async () => {
        const c = await api(app, manager.cookie)
          .post(url())
          .send({ displayName: 'Typo', email: email() });
        const addr = email();
        const res = await api(app, manager.cookie)
          .post(url(`/${c.body.member.id}/invite`))
          .send({ email: addr });
        expect(res.status).toBe(201);
        const invites = await ctx.prisma.invite.findMany({
          where: { membershipId: c.body.member.id },
          orderBy: { createdAt: 'asc' },
        });
        expect(invites).toHaveLength(2);
        expect(invites[0].revokedAt).not.toBeNull();
        expect(invites[1]).toMatchObject({ revokedAt: null, email: addr.toLowerCase() });
      });

      it('audits an email change as member.updated with the field name only, never the address', async () => {
        const c = await api(app, manager.cookie)
          .post(url())
          .send({ displayName: 'Audited', email: email() });
        const id = c.body.member.id;
        const addr = email();
        await api(app, manager.cookie)
          .post(url(`/${id}/invite`))
          .send({ email: addr });
        const rows = await ctx.prisma.auditLog.findMany({
          where: { action: 'member.updated', entityId: id },
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].after).toEqual({ fields: ['email'] });
        expect(
          JSON.stringify(rows[0], (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
        ).not.toContain(addr.toLowerCase());
        // resending to the same address changes nothing -> no further row
        await api(app, manager.cookie)
          .post(url(`/${id}/invite`))
          .send({});
        expect(
          await ctx.prisma.auditLog.count({ where: { action: 'member.updated', entityId: id } }),
        ).toBe(1);
      });

      it('409 ALREADY_MEMBER when another member has the address; nothing changes', async () => {
        const addr = email();
        await api(app, manager.cookie).post(url()).send({ displayName: 'Has', email: addr });
        const ph = await api(app, manager.cookie).post(url()).send({ displayName: 'Dup' });
        const before = mail().sent.length;
        const res = await api(app, manager.cookie)
          .post(url(`/${ph.body.member.id}/invite`))
          .send({ email: addr.toUpperCase() });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ALREADY_MEMBER');
        expect(mail().sent).toHaveLength(before);
        const m = await ctx.prisma.membership.findUniqueOrThrow({
          where: { id: ph.body.member.id },
        });
        expect(m.email).toBeNull();
        expect(await ctx.prisma.invite.count({ where: { membershipId: ph.body.member.id } })).toBe(
          0,
        );
      });

      it('409 INVALID_TRANSITION for a member with a login; email unchanged', async () => {
        const before = await ctx.prisma.membership.findUniqueOrThrow({
          where: { id: employee.membershipId },
        });
        const res = await api(app, manager.cookie)
          .post(url(`/${employee.membershipId}/invite`))
          .send({ email: email() });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('INVALID_TRANSITION');
        const after = await ctx.prisma.membership.findUniqueOrThrow({
          where: { id: employee.membershipId },
        });
        expect(after.email).toBe(before.email);
      });

      it('400 VALIDATION_FAILED for an invalid address', async () => {
        const ph = await api(app, manager.cookie).post(url()).send({ displayName: 'Bad' });
        const res = await api(app, manager.cookie)
          .post(url(`/${ph.body.member.id}/invite`))
          .send({ email: 'not-an-email' });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      });

      it('tenancy: a foreign placeholder is 404 and keeps no email; the same address in another org is allowed', async () => {
        const other = await makeOrg(ctx.prisma);
        const foreign = await makeMember(ctx, other.orgId, {
          accessLevel: 'EMPLOYEE',
          withLogin: false,
        });
        const addr = email();
        const res = await api(app, manager.cookie)
          .post(url(`/${foreign.membershipId}/invite`))
          .send({ email: addr });
        expect(res.status).toBe(404);
        const m = await ctx.prisma.membership.findUniqueOrThrow({
          where: { id: foreign.membershipId },
        });
        expect(m.email).toBeNull();
        expect(
          await ctx.prisma.invite.count({ where: { membershipId: foreign.membershipId } }),
        ).toBe(0);

        await ctx.prisma.membership.update({
          where: { id: foreign.membershipId },
          data: { email: addr.toLowerCase() },
        });
        const ph = await api(app, manager.cookie).post(url()).send({ displayName: 'Same' });
        const ok = await api(app, manager.cookie)
          .post(url(`/${ph.body.member.id}/invite`))
          .send({ email: addr });
        expect(ok.status).toBe(201);
      });
    });

    it('404 for another org membership', async () => {
      const other = await makeOrg(ctx.prisma);
      const m = await makeMember(ctx, other.orgId, { accessLevel: 'EMPLOYEE', withLogin: false });
      const res = await api(app, manager.cookie)
        .post(url(`/${m.membershipId}/invite`))
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
