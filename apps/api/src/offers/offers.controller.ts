import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  createOfferSchema,
  versionSchema,
  type CreateOfferInput,
  type OfferDetailDto,
  type OfferSummaryDto,
  type VersionInput,
} from '@shiftswap/shared';
import type { Response } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import { ZodBody } from '../common/zod-body.pipe';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';
import type { AcceptanceDto } from './offer-views';
import { OffersService, type OfferScope } from './offers.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES: readonly OfferScope[] = ['eligible', 'mine', 'review'];

/** Unknown / malformed offer ids look like any other missing offer. */
function offerId(id: string): string {
  if (!UUID.test(id)) throw new DomainError('NOT_FOUND', 'Not found');
  return id;
}

@Controller('orgs/:orgId/offers')
@UseGuards(SessionGuard, OrgGuard)
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  list(@Org() org: OrgContext, @Query('scope') scope?: string): Promise<OfferSummaryDto[]> {
    if (!SCOPES.includes(scope as OfferScope)) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: [{ path: 'scope', message: `Must be one of ${SCOPES.join(', ')}` }],
      });
    }
    return this.offers.list(org, scope as OfferScope);
  }

  @Post()
  @HttpCode(201)
  create(
    @Org() org: OrgContext,
    @Body(ZodBody(createOfferSchema)) body: CreateOfferInput,
  ): Promise<OfferSummaryDto> {
    return this.offers.create(org, body);
  }

  @Get(':offerId')
  detail(@Org() org: OrgContext, @Param('offerId') id: string): Promise<OfferDetailDto> {
    return this.offers.detail(org, offerId(id));
  }

  /** 201 for a new acceptance, 200 for an idempotent retry or a reactivated row. */
  @Post(':offerId/acceptances')
  async accept(
    @Org() org: OrgContext,
    @Param('offerId') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AcceptanceDto> {
    const { acceptance, created } = await this.offers.accept(org, offerId(id));
    res.status(created ? 201 : 200);
    return acceptance;
  }

  @Delete(':offerId/acceptances/me')
  @HttpCode(204)
  async withdraw(@Org() org: OrgContext, @Param('offerId') id: string): Promise<void> {
    await this.offers.withdraw(org, offerId(id));
  }

  @Post(':offerId/claim')
  @HttpCode(200)
  claim(@Org() org: OrgContext, @Param('offerId') id: string): Promise<OfferSummaryDto> {
    return this.offers.claim(org, offerId(id));
  }

  @Post(':offerId/cancel')
  @HttpCode(200)
  cancel(
    @Org() org: OrgContext,
    @Param('offerId') id: string,
    @Body(ZodBody(versionSchema)) body: VersionInput,
  ): Promise<OfferSummaryDto> {
    return this.offers.cancel(org, offerId(id), body.version);
  }
}
