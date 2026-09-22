import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminDashboardRole } from '../enums/admin-dashboard-role.enum';
import { AdminMembershipStatus } from '../enums/admin-membership-status.enum';
import { AdminMembership } from '../entities/admin-membership.entity';
import { PlatformSettings } from '../entities/platform-settings.entity';
import { AdminHttpRequest, clientIp, normalizeIp } from '../admin-request.util';
import { PLATFORM_SETTINGS_ID } from '../platform-settings.defaults';

@Injectable()
export class AdminMembershipGuard implements CanActivate {
  constructor(
    @InjectRepository(AdminMembership)
    private readonly membershipRepo: Repository<AdminMembership>,
    @InjectRepository(PlatformSettings)
    private readonly settingsRepo: Repository<PlatformSettings>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminHttpRequest>();
    const userId = req.user?.id;
    if (!userId) {
      throw new HttpException(
        { statusCode: HttpStatus.UNAUTHORIZED, message: 'Unauthorized' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const [membership, settings] = await Promise.all([
      this.membershipRepo.findOne({
        where: { userId, status: AdminMembershipStatus.ACTIVE },
      }),
      this.settingsRepo.findOne({ where: { id: PLATFORM_SETTINGS_ID } }),
    ]);
    req.adminMembership = membership;

    if (
      settings?.ipAllowlistEnabled &&
      Array.isArray(settings.ipAllowlist) &&
      settings.ipAllowlist.length > 0
    ) {
      const ip = clientIp(req);
      const allowed = settings.ipAllowlist.map((entry) => normalizeIp(entry));
      if (!allowed.includes(ip)) {
        throw new HttpException(
          {
            statusCode: HttpStatus.FORBIDDEN,
            message:
              'This IP address is not allowed to access the admin console',
          },
          HttpStatus.FORBIDDEN,
        );
      }
    }

    if (!membership) return true;

    const timeoutMinutes = settings?.sessionTimeoutMinutes ?? 30;
    if (membership.lastActiveAt && timeoutMinutes > 0) {
      const gap = Date.now() - new Date(membership.lastActiveAt).getTime();
      if (gap > timeoutMinutes * 60 * 1000) {
        throw new HttpException(
          {
            statusCode: HttpStatus.UNAUTHORIZED,
            message: 'Admin session timed out. Please sign in again.',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    const method = (req.method || 'GET').toUpperCase();
    if (
      membership.role === AdminDashboardRole.READ_ONLY &&
      method !== 'GET' &&
      method !== 'HEAD'
    ) {
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: 'Read-only admins cannot change data',
        },
        HttpStatus.FORBIDDEN,
      );
    }

    await this.membershipRepo.update(
      { id: membership.id },
      { lastActiveAt: new Date() },
    );
    return true;
  }
}
