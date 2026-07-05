import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { TextModerationSurface } from 'src/common/moderation/text-moderation.types';
import { AdminService } from './admin.service';
import { TextModerationQueryDto } from './dtos/text-moderation-query.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('text-moderation')
  @ApiOperation({ summary: 'List text moderation queue' })
  getTextModerationQueue(@Query() query: TextModerationQueryDto) {
    return this.adminService.getTextModerationQueue(query);
  }

  @Patch('text-moderation/:entityType/:id/approve')
  @ApiOperation({ summary: 'Approve pending text moderation item' })
  approveTextModeration(
    @Param('entityType', new ParseEnumPipe(TextModerationSurface))
    entityType: TextModerationSurface,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.approveTextModeration(entityType, id);
  }

  @Patch('text-moderation/:entityType/:id/reject')
  @ApiOperation({ summary: 'Reject pending text moderation item' })
  rejectTextModeration(
    @Param('entityType', new ParseEnumPipe(TextModerationSurface))
    entityType: TextModerationSurface,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminService.rejectTextModeration(entityType, id);
  }
}
