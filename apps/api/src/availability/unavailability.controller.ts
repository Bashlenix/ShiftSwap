import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { createUnavailabilitySchema, type CreateUnavailabilityInput } from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import { SessionGuard } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import { ZodBody } from '../common/zod-body.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UnavailabilityDto {
  id: string;
  startAt: string;
  endAt: string;
}

const toDto = (r: { id: string; startAt: Date; endAt: Date }): UnavailabilityDto => ({
  id: r.id,
  startAt: r.startAt.toISOString(),
  endAt: r.endAt.toISOString(),
});

/** Own unavailability windows; open to every access level. */
@Controller('orgs/:orgId/me/unavailability')
@UseGuards(SessionGuard, OrgGuard)
export class UnavailabilityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Org() org: OrgContext): Promise<UnavailabilityDto[]> {
    const rows = await this.prisma.unavailability.findMany({
      where: {
        organizationId: org.orgId,
        membershipId: org.membershipId,
        endAt: { gt: new Date() },
      },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  @Post()
  @HttpCode(201)
  create(
    @Org() org: OrgContext,
    @Body(ZodBody(createUnavailabilitySchema)) body: CreateUnavailabilityInput,
  ): Promise<UnavailabilityDto> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.unavailability.create({
        data: {
          organizationId: org.orgId,
          membershipId: org.membershipId,
          startAt: new Date(body.startAt),
          endAt: new Date(body.endAt),
        },
      });
      const dto = toDto(row);
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'unavailability.created',
        entityType: 'unavailability',
        entityId: row.id,
        after: { startAt: dto.startAt, endAt: dto.endAt },
      });
      return dto;
    });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Org() org: OrgContext, @Param('id') id: string): Promise<void> {
    if (!UUID.test(id)) throw new DomainError('NOT_FOUND', 'Not found');
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.unavailability.findFirst({
        where: { id, organizationId: org.orgId, membershipId: org.membershipId },
      });
      if (!row) throw new DomainError('NOT_FOUND', 'Not found');
      await tx.unavailability.delete({ where: { id } });
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'unavailability.deleted',
        entityType: 'unavailability',
        entityId: id,
        before: { startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString() },
      });
    });
  }
}
