import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createShiftSchema,
  rangeQuerySchema,
  updateShiftSchema,
  type CreateShiftInput,
  type ShiftDto,
  type ShiftWriteResponse,
  type UpdateShiftInput,
} from '@shiftswap/shared';
import { SessionGuard } from '../auth/session.guard';
import { DomainError } from '../common/domain-error';
import { ZodBody } from '../common/zod-body.pipe';
import { MinAccess } from '../tenancy/min-access.decorator';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';
import { ShiftsService } from './shifts.service';

const MAX_RANGE_MS = 35 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalid = (message: string, path: string) =>
  new DomainError('VALIDATION_FAILED', 'Request validation failed', {
    issues: [{ path, message }],
  });

/** Unknown / malformed shift ids look like any other missing shift. */
function shiftId(id: string): string {
  if (!UUID.test(id)) throw new DomainError('NOT_FOUND', 'Not found');
  return id;
}

@Controller('orgs/:orgId/shifts')
@UseGuards(SessionGuard, OrgGuard)
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  async list(
    @Org() org: OrgContext,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
    @Query('mine') mineRaw?: string,
  ): Promise<ShiftDto[]> {
    const parsed = rangeQuerySchema.safeParse({ from: fromRaw, to: toRaw });
    if (!parsed.success) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.map(String).join('.'),
          message: 'Must be an ISO date-time with offset',
        })),
      });
    }
    const from = new Date(parsed.data.from);
    const to = new Date(parsed.data.to);
    if (to <= from) throw invalid('to must be after from', 'to');
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw invalid('Range can be at most 35 days', 'to');
    }
    const mine = mineRaw === 'true';
    if (!mine && org.accessLevel === 'EMPLOYEE') {
      throw new DomainError('FORBIDDEN', 'Employees can only list their own shifts');
    }
    return this.shifts.list(org, from, to, mine);
  }

  @Post()
  @MinAccess('MANAGER')
  @HttpCode(201)
  create(
    @Org() org: OrgContext,
    @Body(ZodBody(createShiftSchema)) body: CreateShiftInput,
  ): Promise<ShiftWriteResponse> {
    return this.shifts.create(org, body);
  }

  @Patch(':shiftId')
  @MinAccess('MANAGER')
  update(
    @Org() org: OrgContext,
    @Param('shiftId') id: string,
    @Body(ZodBody(updateShiftSchema)) body: UpdateShiftInput,
  ): Promise<ShiftWriteResponse> {
    return this.shifts.update(org, shiftId(id), body);
  }

  @Delete(':shiftId')
  @MinAccess('MANAGER')
  @HttpCode(204)
  async remove(
    @Org() org: OrgContext,
    @Param('shiftId') id: string,
    @Query('version') versionRaw?: string,
  ): Promise<void> {
    const version = Number(versionRaw);
    if (!Number.isInteger(version) || version < 1)
      throw invalid('Must be a positive integer', 'version');
    await this.shifts.remove(org, shiftId(id), version);
  }
}
