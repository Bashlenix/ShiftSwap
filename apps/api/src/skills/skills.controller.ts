import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { skillSchema, type SkillDto, type SkillInput } from '@shiftswap/shared';
import { SessionGuard } from '../auth/session.guard';
import { ZodBody } from '../common/zod-body.pipe';
import { MinAccess } from '../tenancy/min-access.decorator';
import { Org, type OrgContext } from '../tenancy/org-context.decorator';
import { OrgGuard } from '../tenancy/org.guard';
import { SkillsService } from './skills.service';

@Controller('orgs/:orgId/skills')
@UseGuards(SessionGuard, OrgGuard)
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  @MinAccess('EMPLOYEE')
  list(@Org() org: OrgContext): Promise<SkillDto[]> {
    return this.skills.list(org.orgId);
  }

  @Post()
  @HttpCode(201)
  @MinAccess('ADMIN')
  create(@Org() org: OrgContext, @Body(ZodBody(skillSchema)) body: SkillInput): Promise<SkillDto> {
    return this.skills.create(org, body);
  }

  @Patch(':skillId')
  @MinAccess('ADMIN')
  rename(
    @Org() org: OrgContext,
    @Param('skillId') skillId: string,
    @Body(ZodBody(skillSchema)) body: SkillInput,
  ): Promise<SkillDto> {
    return this.skills.rename(org, skillId, body);
  }

  @Delete(':skillId')
  @HttpCode(204)
  @MinAccess('ADMIN')
  async remove(@Org() org: OrgContext, @Param('skillId') skillId: string): Promise<void> {
    await this.skills.remove(org, skillId);
  }
}
