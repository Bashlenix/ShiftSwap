import { PrismaService } from '../src/prisma/prisma.service';

describe('schema: invites and notifications', () => {
  let prisma: PrismaService;
  let organizationId: string;
  let membershipId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    const org = await prisma.organization.create({ data: { name: 'People Schema Org' } });
    organizationId = org.id;
    const m = await prisma.membership.create({
      data: { organizationId, displayName: 'P', accessLevel: 'EMPLOYEE' },
    });
    membershipId = m.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const inviteData = (tokenHash: string) => ({
    organizationId,
    membershipId,
    email: 'p@shiftswap.test',
    tokenHash,
    expiresAt: new Date('2030-01-01T00:00:00Z'),
    createdByMembershipId: membershipId,
  });

  it('rejects a duplicate invite token hash', async () => {
    await prisma.invite.create({ data: inviteData('hash-dup') });
    await expect(prisma.invite.create({ data: inviteData('hash-dup') })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('stores a notification and indexes it by recipient and time', async () => {
    const n = await prisma.notification.create({
      data: {
        organizationId,
        recipientMembershipId: membershipId,
        type: 'OFFER_CREATED',
        payload: { kind: 'GIVE_AWAY' },
      },
    });
    expect(n.readAt).toBeNull();
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'`;
    expect(idx.map((i) => i.indexname)).toContain(
      'notifications_recipient_membership_id_created_at_idx',
    );
  });

  it('stores timestamps as timestamptz', async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE (table_name = 'invites' AND column_name IN ('expires_at','accepted_at','revoked_at','created_at'))
         OR (table_name = 'notifications' AND column_name IN ('read_at','created_at'))`;
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.data_type).toBe('timestamp with time zone');
  });
});
