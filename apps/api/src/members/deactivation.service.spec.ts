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
