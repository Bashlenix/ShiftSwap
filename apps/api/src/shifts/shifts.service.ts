import { Injectable } from '@nestjs/common';
import {
  shiftTimesError,
  type CreateShiftInput,
  type RuleCode,
  type ShiftDto,
  type ShiftWriteResponse,
  type UpdateShiftInput,
} from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/domain-error';
import type { Prisma } from '../generated/prisma/client';
import { checkEligibility } from '../matching/eligibility';
import { EligibilityLoader } from '../matching/eligibility-loader';
import { OfferLifecycle } from '../offers/offer-lifecycle';
import { lockMembership, lockShift } from '../offers/offer-locks';
import { PrismaService } from '../prisma/prisma.service';
import type { OrgContext } from '../tenancy/org-context.decorator';
import { SHIFT_INCLUDE, toAuditSnapshot, toShiftDto, type ShiftRow } from './shift-mapper';

type Tx = Prisma.TransactionClient;

const notFound = () => new DomainError('NOT_FOUND', 'Not found');
const RETRY = Symbol('retry');
const MAX_LOCK_ATTEMPTS = 3;

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loader: EligibilityLoader,
    private readonly lifecycle: OfferLifecycle,
  ) {}

  async list(org: OrgContext, from: Date, to: Date, mine: boolean): Promise<ShiftDto[]> {
    const rows = await this.prisma.shift.findMany({
      where: {
        organizationId: org.orgId,
        deletedAt: null,
        startAt: { lt: to },
        endAt: { gt: from },
        ...(mine ? { assignedMembershipId: org.membershipId } : {}),
      },
      include: SHIFT_INCLUDE,
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toShiftDto);
  }

  /** 404 when the shift is soft-deleted or belongs to another org. */
  async findInOrg(orgId: string, shiftId: string, db: Tx | PrismaService = this.prisma) {
    const row = await db.shift.findFirst({
      where: { id: shiftId, organizationId: orgId, deletedAt: null },
      include: SHIFT_INCLUDE,
    });
    if (!row) throw notFound();
    return row;
  }

  async create(org: OrgContext, input: CreateShiftInput): Promise<ShiftWriteResponse> {
    const skillIds = [...new Set(input.requiredSkillIds)];
    return this.prisma.$transaction(async (tx) => {
      await this.assertOrgRefs(tx, org.orgId, skillIds, input.assignedMembershipId);
      if (input.assignedMembershipId) {
        await this.lockActiveAssignee(tx, org.orgId, input.assignedMembershipId);
      }
      const created = await tx.shift.create({
        data: {
          organizationId: org.orgId,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          assignedMembershipId: input.assignedMembershipId,
          location: input.location ?? null,
          notes: input.notes ?? null,
          skills: { create: skillIds.map((skillId) => ({ skillId })) },
        },
        include: SHIFT_INCLUDE,
      });
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'shift.created',
        entityType: 'shift',
        entityId: created.id,
        after: toAuditSnapshot(created),
      });
      return { shift: toShiftDto(created), warnings: await this.warningsFor(tx, org, created) };
    });
  }

  async update(
    org: OrgContext,
    shiftId: string,
    input: UpdateShiftInput,
  ): Promise<ShiftWriteResponse> {
    return this.inShiftWriteTx(org.orgId, shiftId, async (tx) => {
      const before = await this.findInOrg(org.orgId, shiftId, tx);

      const startAt = input.startAt ?? before.startAt.toISOString();
      const endAt = input.endAt ?? before.endAt.toISOString();
      const message = shiftTimesError(startAt, endAt);
      if (message) {
        throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
          issues: [{ path: 'endAt', message }],
        });
      }

      const skillIds = input.requiredSkillIds ? [...new Set(input.requiredSkillIds)] : undefined;
      await this.assertOrgRefs(tx, org.orgId, skillIds ?? [], input.assignedMembershipId ?? null);
      // Only a new assignee must be active: editing a past shift keeps its (deactivated) holder.
      if (
        input.assignedMembershipId &&
        input.assignedMembershipId !== before.assignedMembershipId
      ) {
        await this.lockActiveAssignee(tx, org.orgId, input.assignedMembershipId);
      }

      const { count } = await tx.shift.updateMany({
        where: { id: shiftId, organizationId: org.orgId, version: input.version, deletedAt: null },
        data: {
          startAt: new Date(startAt),
          endAt: new Date(endAt),
          ...(input.assignedMembershipId !== undefined
            ? { assignedMembershipId: input.assignedMembershipId }
            : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) await this.failWrite(tx, org.orgId, shiftId);

      if (skillIds) {
        await tx.shiftSkill.deleteMany({ where: { shiftId } });
        await tx.shiftSkill.createMany({ data: skillIds.map((skillId) => ({ shiftId, skillId })) });
      }
      const newStartAt = new Date(startAt);
      await this.lifecycle.onShiftChanged(
        tx,
        org.orgId,
        shiftId,
        {
          timesOrSkillsChanged:
            newStartAt.getTime() !== before.startAt.getTime() ||
            new Date(endAt).getTime() !== before.endAt.getTime() ||
            (skillIds !== undefined &&
              !sameSet(
                skillIds,
                before.skills.map((s) => s.skillId),
              )),
          assigneeChanged:
            input.assignedMembershipId !== undefined &&
            input.assignedMembershipId !== before.assignedMembershipId,
          newStartAt,
        },
        org.membershipId,
      );
      const after = await this.findInOrg(org.orgId, shiftId, tx);
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'shift.updated',
        entityType: 'shift',
        entityId: shiftId,
        before: toAuditSnapshot(before),
        after: toAuditSnapshot(after),
      });
      return { shift: toShiftDto(after), warnings: await this.warningsFor(tx, org, after) };
    });
  }

  async remove(org: OrgContext, shiftId: string, version: number): Promise<void> {
    await this.inShiftWriteTx(org.orgId, shiftId, async (tx) => {
      const before = await this.findInOrg(org.orgId, shiftId, tx);
      const { count } = await tx.shift.updateMany({
        where: { id: shiftId, organizationId: org.orgId, version, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      if (count === 0) await this.failWrite(tx, org.orgId, shiftId);
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'shift.deleted',
        entityType: 'shift',
        entityId: shiftId,
        before: toAuditSnapshot(before),
      });
      await this.lifecycle.onShiftDeleted(tx, org.orgId, shiftId, org.membershipId);
    });
  }

  /**
   * Shift write transaction with the swap lock order offer -> shift (SDD §25): lock the shift's
   * OPEN offer first, then the shift row. If an offer was created between the plain read and the
   * shift lock, nothing has been written yet, so the transaction is simply retried.
   */
  private async inShiftWriteTx<T>(
    orgId: string,
    shiftId: string,
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const result = await this.prisma.$transaction(async (tx) => {
        const lockedOfferId = await this.lifecycle.lockOpenOfferOf(tx, orgId, shiftId);
        await lockShift(tx, orgId, shiftId);
        if (!(await this.lifecycle.openOfferUnchanged(tx, orgId, shiftId, lockedOfferId))) {
          return RETRY;
        }
        return { value: await fn(tx) };
      });
      if (result !== RETRY) return result.value;
      if (attempt >= MAX_LOCK_ATTEMPTS) {
        throw new DomainError('VERSION_CONFLICT', 'The shift was changed by someone else');
      }
    }
  }

  /** Version check missed: gone -> 404, otherwise somebody else changed it -> 409. */
  private async failWrite(tx: Tx, orgId: string, shiftId: string): Promise<never> {
    const current = await tx.shift.findFirst({
      where: { id: shiftId, organizationId: orgId, deletedAt: null },
      select: { version: true },
    });
    if (!current) throw notFound();
    throw new DomainError('VERSION_CONFLICT', 'The shift was changed by someone else', {
      currentVersion: current.version,
    });
  }

  private async assertOrgRefs(
    tx: Tx,
    orgId: string,
    skillIds: string[],
    assigneeId: string | null,
  ): Promise<void> {
    if (skillIds.length > 0) {
      const found = await tx.skill.count({
        where: { organizationId: orgId, id: { in: skillIds } },
      });
      if (found !== skillIds.length) throw notFound();
    }
    if (assigneeId) {
      const m = await tx.membership.count({ where: { organizationId: orgId, id: assigneeId } });
      if (m === 0) throw notFound();
    }
  }

  /**
   * Locks the assignee's membership (after any offer -> shift locks, keeping the SDD §25 order)
   * so a concurrent deactivation cannot slip in between; foreign/unknown -> 404,
   * DEACTIVATED -> 409 INVALID_TRANSITION.
   */
  private async lockActiveAssignee(tx: Tx, orgId: string, membershipId: string): Promise<void> {
    await lockMembership(tx, orgId, membershipId);
    const m = await tx.membership.findUniqueOrThrow({
      where: { id: membershipId },
      select: { status: true },
    });
    if (m.status !== 'ACTIVE') {
      throw new DomainError('INVALID_TRANSITION', 'This person is deactivated.');
    }
  }

  /** Non-blocking assignment warnings (IS_OWNER is expected here, so it is dropped). */
  private async warningsFor(tx: Tx, org: OrgContext, shift: ShiftRow): Promise<RuleCode[]> {
    if (!shift.assignedMembershipId) return [];
    const target = EligibilityLoader.toTargetShift(shift);
    const loaded = await this.loader.load(tx, org, target, [shift.assignedMembershipId]);
    const entry = loaded.get(shift.assignedMembershipId);
    if (!entry) return [];
    return checkEligibility(entry.ctx, target).failedRules.filter((r) => r !== 'IS_OWNER');
  }
}
