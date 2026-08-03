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
  TrustQueueAddNoteDto,
  TrustQueueReassignDto,
  TrustQueueResolveDto,
} from './dtos/trust-queue-actions.dto';
import { TrustQueueQueryDto } from './dtos/trust-queue-query.dto';
import { TrustQueueService } from './trust-queue.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/trust-queue')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
export class TrustQueueController {
  constructor(private readonly trustQueueService: TrustQueueService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Trust Queue KPI cards' })
  getSummary() {
    return this.trustQueueService.getSummary();
  }

  @Get('assignees')
  @ApiOperation({ summary: 'Admins available for reassignment' })
  listAssignees() {
    return this.trustQueueService.listAssignees();
  }

  @Get('reports')
  @ApiOperation({ summary: 'Paginated Trust Queue report list' })
  listReports(@Query() query: TrustQueueQueryDto) {
    return this.trustQueueService.listReports(query);
  }

  @Get('reports/:reportId')
  @ApiOperation({ summary: 'Trust Queue report detail' })
  getReport(@Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.trustQueueService.getReport(reportId);
  }

  @Post('reports/:reportId/notes')
  @ApiOperation({ summary: 'Add a case note' })
  addNote(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: TrustQueueAddNoteDto,
    @Req() req,
  ) {
    return this.trustQueueService.addNote(reportId, dto, req.user.id);
  }

  @Patch('reports/:reportId/reassign')
  @ApiOperation({ summary: 'Reassign report to an admin' })
  reassign(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: TrustQueueReassignDto,
    @Req() req,
  ) {
    return this.trustQueueService.reassign(reportId, dto, req.user.id);
  }

  @Patch('reports/:reportId/resolve')
  @ApiOperation({ summary: 'Resolve or escalate a report' })
  resolve(
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: TrustQueueResolveDto,
    @Req() req,
  ) {
    return this.trustQueueService.resolve(reportId, dto, req.user.id);
  }

  @Post('reports/:reportId/suspend')
  @ApiOperation({ summary: 'Suspend the reported account' })
  suspend(@Param('reportId', ParseUUIDPipe) reportId: string, @Req() req) {
    return this.trustQueueService.suspendReportedUser(reportId, req.user.id);
  }
}
