import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import { ZodBody } from '../common/zod-body.pipe';
import { MinAccess } from '../tenancy/min-access.decorator';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';
import { NotificationsService, type NotificationPage } from './notifications.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface ReadInput {
  ids?: string[];
}
const issue = (message: string) => ({
  success: false as const,
  error: { issues: [{ path: ['ids'], message }] },
});
/** `{ ids?: uuid[] }` (at most 200); no ids = mark all own rows read. */
const readSchema = {
  safeParse(input: unknown) {
    if (input === undefined || input === null)
      return { success: true as const, data: {} as ReadInput };
    if (typeof input !== 'object' || Array.isArray(input)) return issue('Expected an object');
    const ids = (input as { ids?: unknown }).ids;
    if (ids === undefined) return { success: true as const, data: {} as ReadInput };
    if (!Array.isArray(ids) || ids.length > 200) return issue('Expected at most 200 ids');
    if (!ids.every((i) => typeof i === 'string' && UUID.test(i))) return issue('Ids must be UUIDs');
    return { success: true as const, data: { ids: ids as string[] } };
  },
};
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw?: string): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
      issues: [{ path: 'limit', message: `Must be an integer from 1 to ${MAX_LIMIT}` }],
    });
  }
  return n;
}

@Controller('orgs/:orgId/notifications')
@UseGuards(SessionGuard, OrgGuard)
@MinAccess('EMPLOYEE')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Org() org: OrgContext,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<NotificationPage> {
    return this.notifications.list(org.orgId, org.membershipId, parseLimit(limit), cursor);
  }

  @Get('unread-count')
  async unreadCount(@Org() org: OrgContext): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(org.orgId, org.membershipId) };
  }

  @Post('read')
  @HttpCode(204)
  async read(@Org() org: OrgContext, @Body(ZodBody(readSchema)) body: ReadInput): Promise<void> {
    await this.notifications.markRead(org.orgId, org.membershipId, body.ids);
  }
}
