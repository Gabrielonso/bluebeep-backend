import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import {
  RiskEngineInvestigationsQueryDto,
  RiskEngineOverviewQueryDto,
  RiskEngineSignalHistoryQueryDto,
  RiskEngineSignalsQueryDto,
} from '../dtos/risk-engine-query.dto';
import {
  TrustQueueAddNoteDto,
  TrustQueueResolveDto,
} from '../dtos/trust-queue-actions.dto';
import { AdminRiskEngineService } from './admin-risk-engine.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/risk-engine')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
export class AdminRiskEngineController {
  constructor(private readonly riskEngineService: AdminRiskEngineService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Risk Engine overview',
    description:
      'Platform risk index, live score breakdown (accountRisk / trustIntegrity), active alerts, automated actions (24h), and highest-risk accounts. Money and login categories are null until those domains exist.',
  })
  getOverview(@Query() query: RiskEngineOverviewQueryDto) {
    return this.riskEngineService.getOverview(query);
  }

  @Get('badge')
  @ApiOperation({
    summary: 'Risk Engine nav badge counts',
    description: 'criticalSignals + openInvestigations for sidebar badge.',
  })
  getBadge() {
    return this.riskEngineService.getBadge();
  }

  @Get('signals')
  @ApiOperation({
    summary: 'Active risk signals feed',
    description:
      'Derived from open abuse reports, suspensions, and rejected content. Geo/device/VPN/money signals are not available yet.',
  })
  getActiveSignals(@Query() query: RiskEngineSignalsQueryDto) {
    return this.riskEngineService.getActiveSignals(query);
  }

  @Get('signals/history')
  @ApiOperation({
    summary: 'Risk signal history',
    description:
      'Pass `from`+`to` (ISO, half-open [from, to)), or `range=24h|7d|30d`. Default (no params): all-time. Returns `from`, `to`, and `preset` in the payload.',
  })
  getSignalHistory(@Query() query: RiskEngineSignalHistoryQueryDto) {
    return this.riskEngineService.getSignalHistory(query);
  }

  @Get('signals/thresholds')
  @ApiOperation({
    summary: 'Static thresholds for live signal types only',
  })
  getSignalThresholds() {
    return this.riskEngineService.getSignalThresholds();
  }

  @Get('investigations/summary')
  @ApiOperation({
    summary: 'Scam / trust investigations KPI summary',
    description:
      'Open/closed counts and cases-by-type from abuse reports. victimsIdentified and bvAtRisk are null.',
  })
  getInvestigationsSummary() {
    return this.riskEngineService.getInvestigationsSummary();
  }

  @Get('investigations')
  @ApiOperation({
    summary: 'Paginated investigations list',
    description:
      'Backed by Trust Queue abuse reports. victims and bvInvolved are null.',
  })
  listInvestigations(@Query() query: RiskEngineInvestigationsQueryDto) {
    return this.riskEngineService.listInvestigations(query);
  }

  @Get('investigations/:reportId')
  @ApiOperation({
    summary: 'Investigation detail with risk profile',
    description:
      'Enriches Trust Queue report detail with scored UserRiskProfile. linkedAccounts and devices are null. Includes nested trustQueue payload.',
  })
  getInvestigation(@Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.riskEngineService.getInvestigation(reportId);
  }

  @Post('investigations/:reportId/notes')
  @ApiOperation({ summary: 'Add an investigation note (Trust Queue)' })
  addNote(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: TrustQueueAddNoteDto,
    @Req() req,
  ) {
    return this.riskEngineService.addNote(reportId, dto, req.user.id);
  }

  @Patch('investigations/:reportId/resolve')
  @ApiOperation({
    summary: 'Resolve or escalate investigation (Trust Queue)',
  })
  resolve(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: TrustQueueResolveDto,
    @Req() req,
  ) {
    return this.riskEngineService.resolve(reportId, dto, req.user.id);
  }

  @Post('investigations/:reportId/suspend')
  @ApiOperation({ summary: 'Suspend the suspect account (Trust Queue)' })
  suspend(@Param('reportId', ParseUUIDPipe) reportId: string, @Req() req) {
    return this.riskEngineService.suspend(reportId, req.user.id);
  }
}
