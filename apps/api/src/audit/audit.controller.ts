import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuditEntryDto } from '@shiftswap/shared';
import { SessionGuard } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import { parseLimit, singleQueryParam } from '../common/query-params';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MinAccess } from '../tenancy/min-access.decorator';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';
import { AUDIT_ENTITY_TYPES, type AuditEntityType } from './audit.service';

const LIMIT = { defaultLimit: 50, max: 100 };
const MAX_ENTITY_ID = 100;

export interface AuditPage {
  items: AuditEntryDto[];
  nextCursor: string | null;
}

const invalid = (path: string, message: string) =>
  new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: [{ path, message }],
  });

/** The id is strictly ordered, so the cursor is simply the last id seen (a positive integer). */
function parseCursor(raw?: string): bigint | null {
  if (raw === undefined) return null;
  if (!/^[1-9]\d{0,18}$/.test(raw)) throw invalid('cursor', 'Invalid cursor');
  const id = BigInt(raw);
  if (id > 9223372036854775807n) throw invalid('cursor', 'Invalid cursor');
  return id;
}

@Controller('orgs/:orgId/audit')
@UseGuards(SessionGuard, OrgGuard)
@MinAccess('MANAGER')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Org() org: OrgContext,
    @Query('entityType') entityTypeRaw?: unknown,
    @Query('entityId') entityIdRaw?: unknown,
    @Query('cursor') cursorRaw?: unknown,
    @Query('limit') limitRaw?: unknown,
  ): Promise<AuditPage> {
    const entityType = singleQueryParam(entityTypeRaw, 'entityType');
    const entityId = singleQueryParam(entityIdRaw, 'entityId');
    const cursor = singleQueryParam(cursorRaw, 'cursor');
    if (entityType !== undefined && !AUDIT_ENTITY_TYPES.includes(entityType as AuditEntityType)) {
      throw invalid('entityType', `Must be one of: ${AUDIT_ENTITY_TYPES.join(', ')}`);
    }
    if (entityId !== undefined && (entityId.length < 1 || entityId.length > MAX_ENTITY_ID)) {
      throw invalid('entityId', `Must be 1 to ${MAX_ENTITY_ID} characters`);
    }
    const limit = parseLimit(limitRaw, LIMIT);
    const before = parseCursor(cursor);

    const where: Prisma.AuditLogWhereInput = {
      organizationId: org.orgId,
      ...(entityType !== undefined ? { entityType } : {}),
      ...(entityId !== undefined ? { entityId } : {}),
      ...(before !== null ? { id: { lt: before } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { actor: { select: { displayName: true } } },
    });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actorName: r.actor?.displayName ?? null,
        before: r.before,
        after: r.after,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > limit && last ? last.id.toString() : null,
    };
  }
}
