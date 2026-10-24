import type { OrgContext } from '../tenancy/org-context.decorator';
import { OrgsService } from './orgs.service';

describe('OrgsService', () => {
  // A lead-time change locks every OPEN offer of the org; Prisma's default 5 s is too short.
  it('runs the settings transaction with a 15 s timeout', async () => {
    const stop = new Error('stop');
    const prisma = { $transaction: jest.fn().mockRejectedValue(stop) };
    const svc = new OrgsService(prisma as never, {} as never);
    const org = { orgId: 'o1', membershipId: 'm1', accessLevel: 'ADMIN' } as OrgContext;
    await expect(svc.update(org, { offerLeadTimeMin: 60 })).rejects.toBe(stop);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
  });
});
