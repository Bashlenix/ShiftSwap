import type { OrgContext } from '../tenancy/org-context.decorator';
import { DeactivationService } from './deactivation.service';

describe('DeactivationService', () => {
  // It locks many rows in one interactive transaction; Prisma's default 5 s is too short.
  it('runs the deactivation transaction with a 15 s timeout', async () => {
    const stop = new Error('stop');
    const prisma = { $transaction: jest.fn().mockRejectedValue(stop) };
    const svc = new DeactivationService(prisma as never, {} as never, {} as never, {} as never);
    const org = { orgId: 'o1', membershipId: 'm1', accessLevel: 'ADMIN' } as OrgContext;
    await expect(svc.deactivate(org, 'm2')).rejects.toBe(stop);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
  });
});

describe('DeactivationService self check', () => {
  const org = { orgId: 'o1', membershipId: 'm1', accessLevel: 'EMPLOYEE', leadTimeMin: 0 };

  /** A transaction mock in which m1 is an ACTIVE employee with nothing to convert. */
  function setup() {
    const target = { id: 'm1', accessLevel: 'EMPLOYEE', status: 'ACTIVE' };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'm1', access_level: 'EMPLOYEE', status: 'ACTIVE' },
        { id: 'm0', access_level: 'ADMIN', status: 'ACTIVE' },
      ]),
      offer: { findMany: jest.fn().mockResolvedValue([]) },
      shift: { findMany: jest.fn().mockResolvedValue([]) },
      invite: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      membership: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(target),
        update: jest.fn().mockResolvedValue({ ...target, status: 'DEACTIVATED' }),
      },
    };
    const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
    const audit = { record: jest.fn() };
    const notifications = { managerIds: jest.fn().mockResolvedValue([]), notify: jest.fn() };
    const svc = new DeactivationService(
      prisma as never,
      audit as never,
      notifications as never,
      {} as never,
    );
    return { svc, tx };
  }

  it('rejects deactivating yourself without selfDeletion', async () => {
    const { svc, tx } = setup();
    await expect(svc.deactivate(org as OrgContext, 'm1')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
    expect(tx.membership.update).not.toHaveBeenCalled();
  });

  it('allows deactivating yourself with selfDeletion', async () => {
    const { svc, tx } = setup();
    await expect(
      svc.deactivate(org as OrgContext, 'm1', { selfDeletion: true }),
    ).resolves.toMatchObject({ unassigned: 0 });
    expect(tx.membership.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'DEACTIVATED' },
    });
  });
});
