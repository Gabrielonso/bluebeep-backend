import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { AdminSettingsService } from './admin-settings.service';
import { RequireAdminPermission } from './decorators/require-admin-permission.decorator';
import {
  UpdateConfigurationDto,
  UpdateNotificationSettingsDto,
  UpdatePlatformSettingsDto,
  UpdatePrivacyPolicyDto,
} from './dto/admin-settings.dto';
import { AdminMembershipGuard } from './guards/admin-membership.guard';
import { AdminPermissionGuard } from './guards/admin-permission.guard';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RoleGuard, AdminMembershipGuard, AdminPermissionGuard)
@Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
export class AdminSettingsController {
  constructor(private readonly adminSettingsService: AdminSettingsService) {}

  @Get('platform')
  @ApiOperation({ summary: 'Platform profile settings' })
  getPlatform() {
    return this.adminSettingsService.getPlatform();
  }

  @Patch('platform')
  @RequireAdminPermission('platform.config')
  @ApiOperation({ summary: 'Update platform profile settings' })
  updatePlatform(@Body() dto: UpdatePlatformSettingsDto, @Req() req) {
    return this.adminSettingsService.updatePlatform(dto, req.user);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Platform notification channel toggles' })
  getNotifications() {
    return this.adminSettingsService.getNotifications();
  }

  @Patch('notifications')
  @RequireAdminPermission('platform.config')
  @ApiOperation({ summary: 'Update platform notification channels' })
  updateNotifications(@Body() dto: UpdateNotificationSettingsDto, @Req() req) {
    return this.adminSettingsService.updateNotifications(dto, req.user);
  }

  @Get('privacy-policy')
  @ApiOperation({ summary: 'Privacy policy body' })
  getPrivacyPolicy() {
    return this.adminSettingsService.getPrivacyPolicy();
  }

  @Patch('privacy-policy')
  @RequireAdminPermission('platform.config')
  @ApiOperation({ summary: 'Update the privacy policy' })
  updatePrivacyPolicy(@Body() dto: UpdatePrivacyPolicyDto, @Req() req) {
    return this.adminSettingsService.updatePrivacyPolicy(dto, req.user);
  }

  @Get('configuration')
  @ApiOperation({
    summary: 'Security, admin notifications, thresholds, and platform info',
  })
  getConfiguration() {
    return this.adminSettingsService.getConfiguration();
  }

  @Patch('configuration')
  @RequireAdminPermission('platform.config')
  @ApiOperation({
    summary: 'Update security, admin notifications, or risk thresholds',
  })
  updateConfiguration(@Body() dto: UpdateConfigurationDto, @Req() req) {
    return this.adminSettingsService.updateConfiguration(dto, req.user);
  }
}
