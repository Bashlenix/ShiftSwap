import type { Auth } from '../auth/auth';
import type { PrismaClient } from '../generated/prisma/client';
import { DEMO_ACCOUNTS, DEMO_ORGS, DEMO_PASSWORD, DEMO_PLACEHOLDERS } from './demo-data';

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
): Promise<{ users: number; organizations: number; memberships: number }> {
  await resetAppTables(prisma);

  const orgIds = new Map<string, string>();
  for (const org of DEMO_ORGS) {
    const created = await prisma.organization.create({ data: { name: org.name } });
    orgIds.set(org.key, created.id);
  }

  for (const account of DEMO_ACCOUNTS) {
    // Library signup hashes the password; never hash by hand.
    const { user } = await auth.api.signUpEmail({
      body: { email: account.email, password: DEMO_PASSWORD, name: account.name },
    });
    for (const m of account.memberships) {
      await prisma.membership.create({
        data: {
          organizationId: orgIds.get(m.org)!,
          userId: user.id,
          displayName: account.name,
          email: account.email,
          accessLevel: m.accessLevel,
        },
      });
    }
  }

  for (const p of DEMO_PLACEHOLDERS) {
    await prisma.membership.create({
      data: {
        organizationId: orgIds.get(p.org)!,
        userId: null,
        displayName: p.name,
        email: null,
        accessLevel: p.accessLevel,
      },
    });
  }

  // Sessions created by signup are not needed; the demo logs in fresh.
  await prisma.session.deleteMany();

  const [users, organizations, memberships] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.membership.count(),
  ]);
  return { users, organizations, memberships };
}
