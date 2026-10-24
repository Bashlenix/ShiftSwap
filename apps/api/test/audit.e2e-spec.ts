import type { INestApplication } from '@nestjs/common';
import { AuditService } from '../src/audit/audit.service';
import { createTestApp, makeMember, makeOrg, type TestCtx } from './helpers/test-app';

describe('AuditService', () => {
  let ctx: TestCtx;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('records an entry with null before/after/metadata', async () => {
    const { orgId } = await makeOrg(ctx.prisma);
    const m = await makeMember(ctx, orgId, { accessLevel: 'MANAGER', withLogin: false });
    const audit = app.get(AuditService);
    await ctx.prisma.$transaction((tx) =>
      audit.record(tx, {
        orgId,
        actorMembershipId: m.membershipId,
        action: 'shift.created',
        entityType: 'shift',
        entityId: 'e1',
        before: null,
        after: null,
        metadata: null,
      }),
    );
    // Prisma reads a JSON `null` and an SQL NULL both as null: check the column itself.
    const rows = await ctx.prisma.$queryRaw<{ b: boolean; a: boolean; m: boolean }[]>`
      SELECT before IS NULL AS b, after IS NULL AS a, metadata IS NULL AS m
      FROM audit_logs WHERE organization_id = ${orgId}`;
    expect(rows).toEqual([{ b: true, a: true, m: true }]);
  });
});
