import { PrismaService } from '../src/prisma/prisma.service';

const START = new Date('2030-01-07T08:00:00Z');
const END = new Date('2030-01-07T16:00:00Z');

describe('schema constraints', () => {
  let prisma: PrismaService;
  let organizationId: string;
  let ownerId: string;
  let otherId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    const org = await prisma.organization.create({ data: { name: 'Constraint Org' } });
    organizationId = org.id;
    const [a, b] = await Promise.all(
      ['A', 'B'].map((displayName) =>
        prisma.membership.create({
          data: { organizationId, displayName, accessLevel: 'EMPLOYEE' },
        }),
      ),
    );
    ownerId = a.id;
    otherId = b.id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const newShift = () =>
    prisma.shift.create({ data: { organizationId, startAt: START, endAt: END } });

  const offerData = (shiftId: string, status: 'OPEN' | 'CANCELLED') => ({
    organizationId,
    shiftId,
    kind: 'OPEN_SHIFT' as const,
    status,
    createdByMembershipId: ownerId,
    expiresAt: START,
  });

  it('stores timestamps as timestamptz', async () => {
    const rows = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'shifts' AND column_name = 'start_at'`;
    expect(rows[0].data_type).toBe('timestamp with time zone');
  });

  it('rejects a shift whose end is not after its start', async () => {
    await expect(
      prisma.shift.create({ data: { organizationId, startAt: END, endAt: START } }),
    ).rejects.toThrow(/shifts_end_after_start/);
    await expect(
      prisma.shift.create({ data: { organizationId, startAt: START, endAt: START } }),
    ).rejects.toThrow(/shifts_end_after_start/);
  });

  it('allows only one OPEN offer per shift', async () => {
    const shift = await newShift();
    await prisma.offer.create({ data: offerData(shift.id, 'OPEN') });
    await expect(prisma.offer.create({ data: offerData(shift.id, 'OPEN') })).rejects.toThrow(
      /offers_one_open_per_shift/,
    );
    await prisma.offer.create({ data: offerData(shift.id, 'CANCELLED') });
  });

  it('rejects duplicate acceptances for the same offer and member', async () => {
    const shift = await newShift();
    const offer = await prisma.offer.create({ data: offerData(shift.id, 'OPEN') });
    const data = {
      organizationId,
      offerId: offer.id,
      membershipId: otherId,
      status: 'PENDING' as const,
    };
    await prisma.acceptance.create({ data });
    await expect(prisma.acceptance.create({ data })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects unavailability whose end is not after its start', async () => {
    await expect(
      prisma.unavailability.create({
        data: { organizationId, membershipId: ownerId, startAt: END, endAt: START },
      }),
    ).rejects.toThrow(/unavailabilities_end_after_start/);
  });
});
