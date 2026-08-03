import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { CommandCenterService } from './command-center.service';
import { CommandCenterAttentionUsersDto } from './dtos/command-center-attention-users.dto';
import { CommandCenterFeedDto } from './dtos/command-center-feed.dto';
import { CommandCenterRangeDto } from './dtos/command-center-range.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/command-center')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
export class CommandCenterController {
  constructor(private readonly commandCenterService: CommandCenterService) {}

  @Get('summary')
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({
    summary: 'Command Center KPI summary',
    description:
      'Pass `from`+`to` (ISO) for a custom window (multi-year allowed), or `range=24h|7d|30d`. Default (no params): all-time. Interval is half-open [from, to). Includes openTrustReports and breachingSla.',
  })
  getSummary(@Query() query: CommandCenterRangeDto) {
    return this.commandCenterService.getSummary(query);
  }

  @Get('risk-summary')
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({
    summary: 'Platform trust/safety counters (live book)',
    description:
      'Full metric shape per field: count, percentage, of, inWindow (null until range supported), breakdown (null). End-user role only. Finance fields null.',
  })
  getRiskSummary() {
    return this.commandCenterService.getRiskSummary();
  }

  @Get('activity-series')
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({
    summary: 'Command Center activity & signup time series',
    description:
      'Same range params as summary (multi-year allowed; default all-time). Auto trunc: ≤48h hour, ≤90d day, ≤3y month, else year.',
  })
  getActivitySeries(@Query() query: CommandCenterRangeDto) {
    return this.commandCenterService.getActivitySeries(query);
  }

  @Get('attention-users')
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({
    summary: 'Users needing attention (suspended / pending / rejected content)',
  })
  getAttentionUsers(@Query() query: CommandCenterAttentionUsersDto) {
    return this.commandCenterService.getAttentionUsers(query);
  }

  @Get('moderation-feed')
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({
    summary:
      'Ops feed of pending/rejected moderation items and open abuse reports',
  })
  getModerationFeed(@Query() query: CommandCenterFeedDto) {
    return this.commandCenterService.getModerationFeed(query);
  }

  @Get('active-calls')
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({ summary: 'Active 1:1 call sessions' })
  getActiveCalls() {
    return this.commandCenterService.getActiveCalls();
  }
}
