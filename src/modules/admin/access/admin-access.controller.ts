import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { AdminAccessService } from './admin-access.service';
import { RequireAdminPermission } from './decorators/require-admin-permission.decorator';
import {
  AdminAuditQueryDto,
  AdminRosterQueryDto,
  InviteAdminDto,
  UpdateAdminDto,
  UpdateRolePermissionsDto,
} from './dto/admin-access.dto';
import { AdminDashboardRole } from './enums/admin-dashboard-role.enum';
import { AdminMembershipGuard } from './guards/admin-membership.guard';
import { AdminPermissionGuard } from './guards/admin-permission.guard';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/access')
@UseGuards(JwtAuthGuard, RoleGuard, AdminMembershipGuard, AdminPermissionGuard)
@Roles([UserRoles.ADMIN, UserRoles.SUPER_ADMIN])
export class AdminAccessController {
  constructor(private readonly adminAccessService: AdminAccessService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Admin access KPI cards' })
  getSummary() {
    return this.adminAccessService.getSummary();
  }

  @Get('admins')
  @ApiOperation({ summary: 'Admin roster' })
  listAdmins(@Query() query: AdminRosterQueryDto) {
    return this.adminAccessService.listAdmins(query);
  }

  @Get('admins/:id')
  @ApiOperation({ summary: 'Admin detail' })
  getAdmin(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminAccessService.getAdmin(id);
  }

  @Post('admins')
  @RequireAdminPermission('admins.manage')
  @ApiOperation({ summary: 'Invite an admin' })
  invite(@Body() dto: InviteAdminDto, @Req() req) {
    return this.adminAccessService.invite(dto, req.user);
  }

  @Patch('admins/:id')
  @RequireAdminPermission('admins.manage')
  @ApiOperation({ summary: 'Update an admin role or pending invite email' })
  updateAdmin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAdminDto,
    @Req() req,
  ) {
    return this.adminAccessService.updateAdmin(id, dto, req.user);
  }

  @Post('admins/:id/revoke')
  @RequireAdminPermission('admins.manage')
  @ApiOperation({ summary: 'Revoke admin access' })
  revoke(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.adminAccessService.revoke(id, req.user);
  }

  @Get('roles')
  @ApiOperation({ summary: 'Role overview' })
  listRoles() {
    return this.adminAccessService.listRoles();
  }

  @Get('roles/:role/permissions')
  @ApiOperation({ summary: 'Permissions granted to a role' })
  getRolePermissions(
    @Param('role', new ParseEnumPipe(AdminDashboardRole))
    role: AdminDashboardRole,
  ) {
    return this.adminAccessService.getRolePermissions(role);
  }

  @Put('roles/:role/permissions')
  @RequireAdminPermission('admins.manage')
  @ApiOperation({ summary: 'Replace permissions for a role' })
  updateRolePermissions(
    @Param('role', new ParseEnumPipe(AdminDashboardRole))
    role: AdminDashboardRole,
    @Body() dto: UpdateRolePermissionsDto,
    @Req() req,
  ) {
    return this.adminAccessService.updateRolePermissions(
      role,
      dto.grants,
      req.user,
    );
  }

  @Post('roles/:role/permissions/reset')
  @RequireAdminPermission('admins.manage')
  @ApiOperation({ summary: 'Reset a role to its default permissions' })
  resetRolePermissions(
    @Param('role', new ParseEnumPipe(AdminDashboardRole))
    role: AdminDashboardRole,
    @Req() req,
  ) {
    return this.adminAccessService.resetRolePermissions(role, req.user);
  }

  @Get('audit')
  @RequireAdminPermission('audit.view')
  @ApiOperation({ summary: 'Admin audit events' })
  listAudit(@Query() query: AdminAuditQueryDto) {
    return this.adminAccessService.listAudit(query);
  }
}
