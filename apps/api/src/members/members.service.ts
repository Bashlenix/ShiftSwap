import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateMemberInput,
  CreateMemberResponse,
  MemberDto,
  ResendInviteInput,
  UpdateMemberInput,
} from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/domain-error';
import { withAfterCommit } from '../common/after-commit';
import type { Membership, Prisma } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { OrgContext } from '../tenancy/org-context.decorator';
import { lockMembership } from '../offers/offer-locks';
import { lockMemberAndAdmins, lockOpenInvites } from './admin-locks';
import { lockSkills } from '../skills/skill-locks';
import { buildInviteMail } from './invite-mail';
import { INVITE_TTL_MS, inviteLink, newInviteToken } from './invite-token';

export const MEMBERS_ENV = Symbol('MEMBERS_ENV');

type Tx = Prisma.TransactionClient;
type MemberRow = Membership & { skills: { skillId: string }[] };

const DEACTIVATED_MSG = 'This person was deactivated — reactivate them instead.';

export const toMemberDto = (m: MemberRow, invitePending: boolean): MemberDto => ({
  id: m.id,
  displayName: m.displayName,
  accessLevel: m.accessLevel,
  email: m.email,
  status: m.status,
  hasLogin: m.userId !== null,
  invitePending,
  skillIds: m.skills.map((s) => s.skillId),
  weeklyLimitMin: m.weeklyLimitMin,
});

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    @Inject(MEMBERS_ENV) private readonly env: NodeJS.ProcessEnv,
  ) {}

  async list(orgId: string, status: 'active' | 'all'): Promise<MemberDto[]> {
    const now = new Date();
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: orgId, ...(status === 'active' ? { status: 'ACTIVE' } : {}) },
      include: {
        skills: { select: { skillId: true } },
        // One query: only the id of at most one open invite per member (no N+1).
        invites: {
          where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
    return rows.map((m) => toMemberDto(m, m.invites.length > 0));
  }

  async create(org: OrgContext, input: CreateMemberInput): Promise<CreateMemberResponse> {
    if (input.accessLevel === 'ADMIN' && org.accessLevel !== 'ADMIN') {
      throw new DomainError('FORBIDDEN', 'Only an admin can create an admin');
    }
    const email = input.email ?? null;
    return withAfterCommit(this.prisma, async (tx, after) => {
      if (email) {
        // Serialise concurrent creates of the same address within this org.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${org.orgId}:${email}`}))`;
        const existing = await tx.membership.findFirst({
          where: {
            organizationId: org.orgId,
            email: { equals: email, mode: 'insensitive' },
            status: { in: ['ACTIVE', 'DEACTIVATED'] },
          },
          orderBy: { status: 'asc' },
        });
        if (existing) {
          throw new DomainError(
            'ALREADY_MEMBER',
            existing.status === 'ACTIVE' ? 'This person is already a member.' : DEACTIVATED_MSG,
          );
        }
      }
      await lockSkills(tx, org.orgId, input.skillIds);
      const member = await tx.membership.create({
        data: {
          organizationId: org.orgId,
          displayName: input.displayName,
          email,
          accessLevel: input.accessLevel,
          weeklyLimitMin: input.weeklyLimitMin ?? null,
          skills: { create: [...new Set(input.skillIds)].map((skillId) => ({ skillId })) },
        },
        include: { skills: { select: { skillId: true } } },
      });
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'member.created',
        entityType: 'membership',
        entityId: member.id,
        metadata: {
          accessLevel: member.accessLevel,
          skillIds: member.skills.map((s) => s.skillId),
          weeklyLimitMin: member.weeklyLimitMin,
        },
      });
      if (!email) return { member: toMemberDto(member, false), inviteLink: null };
      const link = await this.issueInvite(tx, after, org, member.id, email, input.appOrigin);
      return { member: toMemberDto(member, true), inviteLink: link };
    });
  }

  async update(
    org: OrgContext,
    membershipId: string,
    input: UpdateMemberInput,
  ): Promise<MemberDto> {
    return this.prisma.$transaction(async (tx) => {
      const levelRequested = input.accessLevel !== undefined;
      let current: Membership;
      if (levelRequested) {
        const locked = await lockMemberAndAdmins(tx, org.orgId, membershipId);
        current = locked.target;
        if (input.accessLevel !== current.accessLevel) {
          if (org.accessLevel !== 'ADMIN') {
            throw new DomainError('FORBIDDEN', 'Only an admin can change access levels');
          }
          if (
            current.accessLevel === 'ADMIN' &&
            current.status === 'ACTIVE' &&
            locked.activeAdminIds.length <= 1
          ) {
            throw new DomainError('LAST_ADMIN', 'The last admin cannot be demoted');
          }
        }
      } else {
        await lockMembership(tx, org.orgId, membershipId);
        current = await tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
      }
      if (input.skillIds) await lockSkills(tx, org.orgId, input.skillIds);

      const updated = await tx.membership.update({
        where: { id: membershipId },
        data: {
          displayName: input.displayName,
          accessLevel: input.accessLevel,
          weeklyLimitMin: input.weeklyLimitMin,
          ...(input.skillIds
            ? {
                skills: {
                  deleteMany: {},
                  create: [...new Set(input.skillIds)].map((skillId) => ({ skillId })),
                },
              }
            : {}),
        },
        include: { skills: { select: { skillId: true } } },
      });
      await this.audit.record(tx, {
        orgId: org.orgId,
        actorMembershipId: org.membershipId,
        action: 'member.updated',
        entityType: 'membership',
        entityId: membershipId,
        metadata: {
          ...(input.accessLevel !== undefined ? { accessLevel: updated.accessLevel } : {}),
          ...(input.skillIds ? { skillIds: updated.skills.map((s) => s.skillId) } : {}),
          ...(input.weeklyLimitMin !== undefined ? { weeklyLimitMin: updated.weeklyLimitMin } : {}),
        },
      });
      const pending = await tx.invite.count({
        where: {
          membershipId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      return toMemberDto(updated, pending > 0);
    });
  }

  async resendInvite(
    org: OrgContext,
    membershipId: string,
    input: ResendInviteInput,
  ): Promise<{ inviteLink: string }> {
    return withAfterCommit(this.prisma, async (tx, after) => {
      // Invites before the membership: accepting an invite locks invite -> membership.
      await lockOpenInvites(tx, org.orgId, membershipId);
      await lockMembership(tx, org.orgId, membershipId);
      const m = await tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
      if (!m.email || m.userId !== null || m.status !== 'ACTIVE') {
        throw new DomainError(
          'INVALID_TRANSITION',
          'Only an active placeholder with an email address can be invited',
        );
      }
      await tx.invite.updateMany({
        where: { membershipId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const link = await this.issueInvite(tx, after, org, membershipId, m.email, input.appOrigin);
      return { inviteLink: link };
    });
  }

  /** Creates the invite row, audits it and queues the mail. Never logs or audits the token. */
  private async issueInvite(
    tx: Tx,
    after: (job: () => Promise<void>) => void,
    org: OrgContext,
    membershipId: string,
    email: string,
    appOrigin: string | undefined,
  ): Promise<string> {
    const { token, tokenHash } = newInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const invite = await tx.invite.create({
      data: {
        organizationId: org.orgId,
        membershipId,
        email,
        tokenHash,
        expiresAt,
        createdByMembershipId: org.membershipId,
      },
    });
    await this.audit.record(tx, {
      orgId: org.orgId,
      actorMembershipId: org.membershipId,
      action: 'invite.created',
      entityType: 'invite',
      entityId: invite.id,
      metadata: { membershipId },
    });
    const orgRow = await tx.organization.findUniqueOrThrow({
      where: { id: org.orgId },
      select: { name: true, timezone: true },
    });
    const link = inviteLink(appOrigin, this.env, token);
    const message = buildInviteMail({
      to: email,
      orgName: orgRow.name,
      link,
      expiresAt,
      timeZone: orgRow.timezone,
      membershipId,
    });
    after(() => this.mail.send(message));
    return link;
  }
}
