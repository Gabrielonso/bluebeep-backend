import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { UserIntelligenceService } from './user-intelligence.service';
import { UserIntelligenceQueryDto } from './dtos/user-intelligence-query.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/user-intelligence')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
export class UserIntelligenceController {
  constructor(
    private readonly userIntelligenceService: UserIntelligenceService,
  ) {}

  @Get('summary')
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({
    summary: 'User Intelligence list page KPI cards',
  })
  getSummary() {
    return this.userIntelligenceService.getSummary();
  }

  @Get()
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({
    summary:
      'Paginated User Intelligence table (tabs, search, country, risk sort)',
  })
  listUsers(@Query() query: UserIntelligenceQueryDto) {
    return this.userIntelligenceService.listUsers(query);
  }

  @Get(':userId')
  @Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
  @ApiOperation({
    summary:
      'User Intelligence detail — identity, moderation-first risk, activity, enforcement',
  })
  getUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.userIntelligenceService.getUserIntelligence(userId);
  }
}
