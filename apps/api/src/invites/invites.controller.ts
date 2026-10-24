import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { InvitePreviewDto } from '@shiftswap/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionGuard, type AuthUser } from '../auth/session.guard';
import { InvitesService } from './invites.service';
import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';

/** Not org-scoped: the token identifies the invite. Throttled per client IP (same resolution as the auth rate limiter). */
@Controller('invites')
@UseGuards(ClientIpThrottlerGuard)
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
