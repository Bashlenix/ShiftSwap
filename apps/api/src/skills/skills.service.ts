import { Injectable } from '@nestjs/common';
import type { SkillDto, SkillInput } from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/domain-error';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OrgContext } from '../tenancy/org-context.decorator';

type Tx = Prisma.TransactionClient;

const notFound = () => new DomainError('NOT_FOUND', 'Not found');
const duplicate = () =>
  new DomainError('VALIDATION_FAILED', 'A skill with this name already exists', undefined, 409);
const isUniqueViolation = (e: unknown) => (e as { code?: unknown }).code === 'P2002';

/** The org's skills catalogue (FR-03). Names are unique per org regardless of case. */
@Injectable()
export class SkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string): Promise<SkillDto[]> {
    const rows = await this.prisma.skill.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
    });
    return rows.map((s) => ({ id: s.id, name: s.name }));
  }

  async create(org: OrgContext, input: SkillInput): Promise<SkillDto> {
    return this.uniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        const skill = await tx.skill.create({
          data: { organizationId: org.orgId, name: input.name },
        });
        await this.audit.record(tx, {
          orgId: org.orgId,
          actorMembershipId: org.membershipId,
          action: 'skill.created',
          entityType: 'skill',
          entityId: skill.id,
          after: { name: skill.name },
        });
        return { id: skill.id, name: skill.name };
      }),
    );
  }

  async rename(org: OrgContext, skillId: string, input: SkillInput): Promise<SkillDto> {
    return this.uniqueName(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.lockSkill(tx, org.orgId, skillId);
        const skill = await tx.skill.update({ where: { id: skillId }, data: { name: input.name } });
        await this.audit.record(tx, {
          orgId: org.orgId,
          actorMembershipId: org.membershipId,
          action: 'skill.updated',
          entityType: 'skill',
          entityId: skillId,
          before: { name: before.name },
          after: { name: skill.name },
        });
        return { id: skill.id, name: skill.name };
      }),
    );
  }

  /**
   * Deletes the skill unless a non-deleted shift starting in the future requires it
   * (409 SKILL_IN_USE). Member and past-shift join rows cascade. The skill row is locked
   * first, so a concurrent shift write adding it waits (its join-row FK check) and then fails.
   */
  async remove(org: OrgContext, skillId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.lockSkill(tx, org.orgId, skillId);
      const shiftCount = await tx.shift.count({
        where: {
          organizationId: org.orgId,
          deletedAt: null,
          startAt: { gt: new Date() },
          skills: { some: { skillId } },
        },
      });
      if (shiftCount > 0) {
        throw new DomainError('SKILL_IN_USE', 'This skill is still required by upcoming shifts.', {
          shiftCount,
        });
      }
      await tx.skill.delete({ where: { id: skillId } });
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'skill.deleted',
        entityType: 'skill',
        entityId: skillId,
        before: { name: before.name },
      });
    });
  }

  /** Org-scoped row lock; a foreign or unknown id looks missing (404). */
  private async lockSkill(tx: Tx, orgId: string, skillId: string): Promise<{ name: string }> {
    const rows = await tx.$queryRaw<{ name: string }[]>`
      SELECT name FROM "skills" WHERE id = ${skillId} AND organization_id = ${orgId} FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    return rows[0];
  }

  private async uniqueName<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) throw duplicate();
      throw e;
    }
  }
}
