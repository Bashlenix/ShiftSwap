import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessLevel } from '@shiftswap/shared';
import type { Request } from 'express';
import type { OrgPolicy } from '../matching/types';

export interface OrgContext {
  orgId: string;
  membershipId: string;
  accessLevel: AccessLevel;
  timezone: string;
  policy: OrgPolicy;
  leadTimeMin: number;
}

export type OrgRequest = Request & { org: OrgContext };

export const Org = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrgContext =>
    ctx.switchToHttp().getRequest<OrgRequest>().org,
);
