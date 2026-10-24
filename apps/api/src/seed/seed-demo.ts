import { DateTime } from 'luxon';
import type { Auth } from '../auth/auth';
import type { PrismaClient } from '../generated/prisma/client';
import {
  DEMO_ACCOUNTS,
  DEMO_INVITES,
  DEMO_NOTIFICATIONS,
  DEMO_MEMBER_SKILLS,
  DEMO_OFFERS,
  DEMO_OFFER_LEAD_MIN,
  DEMO_ORGS,
  DEMO_PASSWORD,
  DEMO_PLACEHOLDERS,
  DEMO_SHIFTS,
  DEMO_SKILLS,
  demoShiftWindow,
} from './demo-data';
import { INVITE_TTL_MS, newInviteToken } from '../members/invite-token';

const DEMO_TZ = 'Europe/Berlin';

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Empties every app table in the current schema (all but Prisma's migration log).
 * The table list comes from the catalog, so tables added later are covered and FK
 * order never matters.
 */
async function resetAppTables(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<{ schemaname: string; tablename: string }[]>`
    SELECT schemaname, tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `${quoteIdent(t.schemaname)}.${quoteIdent(t.tablename)}`);
  // Identifiers come from the catalog (no user input) and are quoted.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list.join(', ')} RESTART IDENTITY CASCADE`);
}

/** Wipes all app tables, then recreates the demo data. Safe to run on every start. */
export async function seedDemo(
  prisma: PrismaClient,
  auth: Auth,
): Promise<{
  users: number;
  organizations: number;
  memberships: number;
  skills: number;
  shifts: number;
  offers: number;
  acceptances: number;
  invites: number;
  notifications: number;
}> {
  await resetAppTables(prisma);

  const orgIds = new Map<string, string>();
  for (const org of DEMO_ORGS) {
    const created = await prisma.organization.create({
      data: { name: org.name, timezone: DEMO_TZ, offerLeadTimeMin: DEMO_OFFER_LEAD_MIN },
    });
    orgIds.set(org.key, created.id);
  }
  // Memberships by `${org}|${email or placeholder name}`.
  const memberIds = new Map<string, string>();

  for (const account of DEMO_ACCOUNTS) {
    // Library signup hashes the password; never hash by hand.
    const { user } = await auth.api.signUpEmail({
      body: { email: account.email, password: DEMO_PASSWORD, name: account.name },
    });
    for (const m of account.memberships) {
      const membership = await prisma.membership.create({
        data: {
          organizationId: orgIds.get(m.org)!,
          userId: user.id,
          displayName: account.name,
          email: account.email,
          accessLevel: m.accessLevel,
        },
      });
      memberIds.set(`${m.org}|${account.email}`, membership.id);
    }
  }

  for (const p of DEMO_PLACEHOLDERS) {
    const membership = await prisma.membership.create({
      data: {
        organizationId: orgIds.get(p.org)!,
        userId: null,
        displayName: p.name,
        email: null,
        accessLevel: p.accessLevel,
      },
    });
    memberIds.set(`${p.org}|${p.name}`, membership.id);
  }

  // Skills.
  const skillIds = new Map<string, string>();
  for (const s of DEMO_SKILLS) {
    const created = await prisma.skill.create({
      data: { organizationId: orgIds.get(s.org)!, name: s.name },
    });
    skillIds.set(`${s.org}|${s.name}`, created.id);
  }
  await prisma.membershipSkill.createMany({
    data: DEMO_MEMBER_SKILLS.flatMap((ms) =>
      ms.skills.map((name) => ({
        membershipId: memberIds.get(`${ms.org}|${ms.member}`)!,
        skillId: skillIds.get(`${ms.org}|${name}`)!,
      })),
    ),
  });

  // Pending invites: a login-less membership plus an invite row (only the token hash is stored).
  for (const inv of DEMO_INVITES) {
    const orgId = orgIds.get(inv.org)!;
    const createdBy = memberIds.get(`${inv.org}|${inv.createdBy}`)!;
    const membership = await prisma.membership.create({
      data: {
        organizationId: orgId,
        userId: null,
        displayName: inv.displayName,
        email: inv.email,
        accessLevel: inv.accessLevel,
        skills: {
          create: inv.skills.map((name) => ({ skillId: skillIds.get(`${inv.org}|${name}`)! })),
        },
      },
    });
    memberIds.set(`${inv.org}|${inv.email}`, membership.id);
    await prisma.invite.create({
      data: {
        organizationId: orgId,
        membershipId: membership.id,
        email: inv.email,
        tokenHash: newInviteToken().tokenHash,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        createdByMembershipId: createdBy,
      },
    });
  }

  // Shifts, relative to today in the org timezone.
  const today = DateTime.now().setZone(DEMO_TZ).startOf('day');
  const shiftRows = DEMO_SHIFTS.map((s) => ({
    def: s,
    id: crypto.randomUUID(),
    ...demoShiftWindow(today, s, DEMO_TZ),
  }));
  await prisma.shift.createMany({
    data: shiftRows.map((r) => ({
      id: r.id,
      organizationId: orgIds.get(r.def.org)!,
      startAt: r.startAt,
      endAt: r.endAt,
      assignedMembershipId: r.def.assignee
        ? memberIds.get(`${r.def.org}|${r.def.assignee}`)!
        : null,
    })),
  });
  await prisma.shiftSkill.createMany({
    data: shiftRows.flatMap((r) =>
      r.def.skills.map((name) => ({
        shiftId: r.id,
        skillId: skillIds.get(`${r.def.org}|${name}`)!,
      })),
    ),
  });

  // Offers + acceptances (Lukas strictly before Mia so ties break in his favour).
  const now = Date.now();
  const offerIds = new Map<string, string>();
  for (const o of DEMO_OFFERS) {
    const shift = shiftRows.find((r) => r.def.key === o.shift)!;
    const org = shift.def.org;
    const expiresAt = new Date(shift.startAt.getTime() - DEMO_OFFER_LEAD_MIN * 60_000);
    if (expiresAt.getTime() <= now) {
      throw new Error(`Demo offer on ${o.shift} would already be expired`);
    }
    const offer = await prisma.offer.create({
      data: {
        organizationId: orgIds.get(org)!,
        shiftId: shift.id,
        kind: o.kind,
        originalOwnerMembershipId: o.originalOwner
          ? memberIds.get(`${org}|${o.originalOwner}`)!
          : null,
        createdByMembershipId: memberIds.get(`${org}|${o.createdBy}`)!,
        expiresAt,
      },
    });
    offerIds.set(o.shift, offer.id);
    await prisma.acceptance.createMany({
      data: o.acceptances.map((email, i) => ({
        organizationId: orgIds.get(org)!,
        offerId: offer.id,
        membershipId: memberIds.get(`${org}|${email}`)!,
        status: 'PENDING' as const,
        createdAt: new Date(now - (o.acceptances.length - i) * 60_000),
      })),
    });
  }

  // Unread notifications, same payload shape as the live ones (IDs, times, kind, role).
  for (const n of DEMO_NOTIFICATIONS) {
    const shift = shiftRows.find((r) => r.def.key === n.shift)!;
    const offerDef = DEMO_OFFERS.find((o) => o.shift === n.shift)!;
    await prisma.notification.create({
      data: {
        organizationId: orgIds.get(shift.def.org)!,
        recipientMembershipId: memberIds.get(`${shift.def.org}|${n.recipient}`)!,
        type: n.type,
        payload: {
          offerId: offerIds.get(n.shift)!,
          shiftId: shift.id,
          shiftStartAt: shift.startAt.toISOString(),
          shiftEndAt: shift.endAt.toISOString(),
          kind: offerDef.kind,
          role: n.role,
        },
      },
    });
  }

  // Sessions created by signup are not needed; the demo logs in fresh.
  await prisma.session.deleteMany();

  const [
    users,
    organizations,
    memberships,
    skills,
    shifts,
    offers,
    acceptances,
    invites,
    notifications,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.membership.count(),
    prisma.skill.count(),
    prisma.shift.count(),
    prisma.offer.count(),
    prisma.acceptance.count(),
    prisma.invite.count(),
    prisma.notification.count(),
  ]);
  return {
    users,
    organizations,
    memberships,
    skills,
    shifts,
    offers,
    acceptances,
    invites,
    notifications,
  };
}
