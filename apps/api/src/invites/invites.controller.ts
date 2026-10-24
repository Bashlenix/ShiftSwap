import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { InvitePreviewDto } from '@shiftswap/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard, type AuthUser } from '../auth/session.guard';
import { InvitesService } from './invites.service';

/** Not org-scoped: the token identifies the invite. Throttled per client IP (req.ip, `trust proxy 1`). */
@Controller('invites')
@UseGuards(ThrottlerGuard)
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Get(':token')
  preview(@Param('token') token: string): Promise<InvitePreviewDto> {
    return this.invites.preview(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  accept(
    @Param('token') token: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ organizationId: string }> {
    return this.invites.accept(token, user);
  }
}
