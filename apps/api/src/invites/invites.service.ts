import { Injectable } from '@nestjs/common';
import type { InvitePreviewDto } from '@shiftswap/shared';
import { AuditService } from '../audit/audit.service';
import { DomainError } from '../common/domain-error';
import type { AuthUser } from '../auth/session.guard';
import type { Prisma } from '../generated/prisma/client';
import { hashInviteToken } from '../members/invite-token';
import { lockMembership } from '../offers/offer-locks';
import { PrismaService } from '../prisma/prisma.service';

type State = InvitePreviewDto['state'];

interface InviteRow {
  id: string;
  organization_id: string;
  membership_id: string;
  email: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

/** REVOKED > USED > EXPIRED > VALID. A deactivated placeholder can no longer be claimed -> REVOKED. */
function stateOf(
  inv: { revokedAt: Date | null; acceptedAt: Date | null; expiresAt: Date },
  membership: { status: string; userId: string | null },
  now: Date,
): State {
  if (inv.revokedAt || membership.status !== 'ACTIVE') return 'REVOKED';
  if (inv.acceptedAt || membership.userId) return 'USED';
  if (inv.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'VALID';
}

const ALREADY_MEMBER_MSG = 'You are already a member of this organization.';

const notFound = () => new DomainError('NOT_FOUND', 'Not found');

const MESSAGES: Record<Exclude<State, 'VALID'>, string> = {
  USED: 'This invite has already been used.',
  EXPIRED: 'This invite has expired.',
  REVOKED: 'This invite is no longer valid.',
};

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(token: string): Promise<InvitePreviewDto> {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: {
        organization: { select: { name: true } },
        membership: { select: { status: true, userId: true } },
      },
    });
    if (!invite) throw notFound();
    return {
      organizationName: invite.organization.name,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
      state: stateOf(invite, invite.membership, new Date()),
    };
  }

  async accept(token: string, user: AuthUser): Promise<{ organizationId: string }> {
    return this.prisma.$transaction(async (tx) => {
      // Lock order: invite -> membership (nothing else locks invites).
      const rows = await tx.$queryRaw<InviteRow[]>`
        SELECT id, organization_id, membership_id, email, expires_at, accepted_at, revoked_at
        FROM "invites" WHERE token_hash = ${hashInviteToken(token)} FOR UPDATE`;
      const invite = rows[0];
      if (!invite) throw notFound();
      await lockMembership(tx, invite.organization_id, invite.membership_id);
      const membership = await tx.membership.findFirstOrThrow({
        where: { id: invite.membership_id, organizationId: invite.organization_id },
        select: { status: true, userId: true },
      });

      const state = stateOf(
        { revokedAt: invite.revoked_at, acceptedAt: invite.accepted_at, expiresAt: invite.expires_at },
        membership,
        new Date(),
      );
      if (state !== 'VALID') {
        throw new DomainError('INVITE_INVALID', MESSAGES[state], { state });
      }
      // Better Auth may or may not lowercase; compare case-insensitively.
      const sessionEmail = user.email.toLowerCase();
      if (sessionEmail !== invite.email.toLowerCase()) {
        throw new DomainError(
          'EMAIL_MISMATCH',
          'This invite was sent to a different email address.',
        );
      }
      await this.assertNotMember(tx, invite.organization_id, user.id);

      try {
        await tx.membership.update({
          where: { id: invite.membership_id },
          data: { userId: user.id, email: sessionEmail },
        });
      } catch (e) {
        // Concurrent accept of a second invite for the same org: (organization_id, user_id) is unique.
        if ((e as { code?: string }).code === 'P2002') {
          throw new DomainError('ALREADY_MEMBER', ALREADY_MEMBER_MSG);
        }
        throw e;
      }
      await tx.invite.updateMany({ where: { id: invite.id, organizationId: invite.organization_id }, data: { acceptedAt: new Date() } });
      await this.audit.record(tx, {
        orgId: invite.organization_id,
        actorMembershipId: invite.membership_id,
        action: 'invite.accepted',
        entityType: 'invite',
        entityId: invite.id,
        metadata: { membershipId: invite.membership_id },
      });
      return { organizationId: invite.organization_id };
    });
  }

  private async assertNotMember(tx: Prisma.TransactionClient, orgId: string, userId: string) {
    const existing = await tx.membership.findFirst({
      where: { organizationId: orgId, userId },
      select: { id: true },
    });
    if (existing) {
      throw new DomainError('ALREADY_MEMBER', ALREADY_MEMBER_MSG);
    }
  }
}
