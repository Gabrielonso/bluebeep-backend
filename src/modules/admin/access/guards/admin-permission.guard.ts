import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ADMIN_PERMISSION_KEY } from '../decorators/require-admin-permission.decorator';
import { AdminDashboardRole } from '../enums/admin-dashboard-role.enum';
import { AdminMembershipStatus } from '../enums/admin-membership-status.enum';
import { AdminMembership } from '../entities/admin-membership.entity';
import { AdminRolePermission } from '../entities/admin-role-permission.entity';
import { AdminHttpRequest } from '../admin-request.util';

@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(AdminMembership)
    private readonly membershipRepo: Repository<AdminMembership>,
    @InjectRepository(AdminRolePermission)
    private readonly rolePermRepo: Repository<AdminRolePermission>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string>(
      ADMIN_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) return true;

    const req = context.switchToHttp().getRequest<AdminHttpRequest>();
    let membership = req.adminMembership;
    if (membership === undefined && req.user?.id) {
      membership = await this.membershipRepo.findOne({
        where: {
          userId: req.user.id,
          status: AdminMembershipStatus.ACTIVE,
        },
      });
      req.adminMembership = membership;
    }

    const isSuperAdmin = membership?.role === AdminDashboardRole.SUPER_ADMIN;
    if (isSuperAdmin) return true;

    if (!membership) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'You are not allowed to perform this action',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const grant = await this.rolePermRepo.findOne({
      where: {
        role: membership.role,
        permissionKey: permission,
        enabled: true,
      },
    });
    if (!grant) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'You are not allowed to perform this action',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
