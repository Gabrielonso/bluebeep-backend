import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ILike, In, MoreThan, Not, Repository } from 'typeorm';
import { JobQueue, JobType } from 'src/common/enums/jobs.enum';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import { successResponse } from 'src/common/helpers/response.helper';
import { NotificationService } from 'src/modules/notification/notification.service';
import { User } from 'src/modules/user/entity/user.entity';
import { PresenceService } from 'src/realtime/services/presence.service';
import {
  ADMIN_PERMISSION_GROUPS,
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_META,
  ADMINS_MANAGE_PERMISSION,
  AdminAuditAction,
  PERMISSION_CHANGE_ACTIONS,
  isDefaultEnabled,
  roleLabel,
} from './admin-permissions.catalog';
import { AdminActor, displayName, initials } from './admin-request.util';
import {
  AdminAuditQueryDto,
  AdminRosterQueryDto,
  InviteAdminDto,
  UpdateAdminDto,
} from './dto/admin-access.dto';
import { AdminDashboardRole } from './enums/admin-dashboard-role.enum';
import { AdminMembershipStatus } from './enums/admin-membership-status.enum';
import { AdminAuditEvent } from './entities/admin-audit-event.entity';
import { AdminMembership } from './entities/admin-membership.entity';
import { AdminPermission } from './entities/admin-permission.entity';
import { AdminRolePermission } from './entities/admin-role-permission.entity';
import { PlatformSettings } from './entities/platform-settings.entity';
import { PLATFORM_SETTINGS_ID } from './platform-settings.defaults';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AdminAccessService {
  private readonly logger = new Logger(AdminAccessService.name);

  constructor(
    @InjectRepository(AdminMembership)
    private readonly membershipRepo: Repository<AdminMembership>,
    @InjectRepository(AdminPermission)
    private readonly permissionRepo: Repository<AdminPermission>,
    @InjectRepository(AdminRolePermission)
    private readonly rolePermRepo: Repository<AdminRolePermission>,
    @InjectRepository(AdminAuditEvent)
    private readonly auditRepo: Repository<AdminAuditEvent>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(PlatformSettings)
    private readonly settingsRepo: Repository<PlatformSettings>,
    private readonly notificationService: NotificationService,
    private readonly presenceService: PresenceService,
    private readonly configService: ConfigService,
    @InjectQueue(JobQueue.EMAILS)
    private readonly emailQueue: Queue,
  ) {}

  async getSummary() {
    const since = new Date(Date.now() - SEVEN_DAYS_MS);
    const [active, pendingInvites, permissionChanges7d] = await Promise.all([
      this.membershipRepo.find({
        where: { status: AdminMembershipStatus.ACTIVE },
        select: ['id', 'userId'],
      }),
      this.membershipRepo.count({
        where: { status: AdminMembershipStatus.PENDING },
      }),
      this.auditRepo.count({
        where: {
          action: In(PERMISSION_CHANGE_ACTIONS),
          createdAt: MoreThan(since),
        },
      }),
    ]);

    const onlineFlags = await Promise.all(
      active.map((membership) =>
        membership.userId
          ? this.presenceService.isOnline(membership.userId)
          : Promise.resolve(false),
      ),
    );
    const activeNow = onlineFlags.filter(Boolean).length;

    return successResponse('Operation successful', {
      totalAdmins: active.length,
      activeNow,
      pendingInvites,
      permissionChanges7d,
    });
  }

  async listAdmins(query: AdminRosterQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const qb = this.membershipRepo.createQueryBuilder('m');

    if (query.status) {
      qb.andWhere('m.status = :status', { status: query.status });
    }
    if (query.role) {
      qb.andWhere('m.role = :role', { role: query.role });
    }
    if (query.search?.trim()) {
      const q = `%${query.search.trim().toLowerCase()}%`;
      qb.leftJoin(User, 'u', 'u.id = m.user_id');
      qb.andWhere(
        `(
          LOWER(m.email) LIKE :q
          OR LOWER(COALESCE(u.first_name, '')) LIKE :q
          OR LOWER(COALESCE(u.last_name, '')) LIKE :q
          OR LOWER(COALESCE(u.username, '')) LIKE :q
        )`,
        { q },
      );
    }

    qb.orderBy('m.created_at', 'DESC');
    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const users = await this.loadUsers(rows.map((row) => row.userId));
    const actionCounts = await this.countActions(
      rows.map((row) => row.id),
      new Date(Date.now() - SEVEN_DAYS_MS),
    );
    const timeoutMinutes = await this.sessionTimeoutMinutes();
    const presence = await this.presenceMap(rows);

    return successResponse('Operation successful', {
      items: rows.map((row) => {
        const user = row.userId ? users.get(row.userId) : undefined;
        const name = displayName(user, row.email);
        return {
          id: row.id,
          userId: row.userId,
          email: row.email,
          displayName: name,
          initials: initials(name),
          profilePicture: user?.profilePicture ?? null,
          role: row.role,
          roleLabel: roleLabel(row.role),
          status: row.status,
          presence: this.presenceFor(row, presence, timeoutMinutes),
          lastActiveAt: row.lastActiveAt,
          actions7d: actionCounts.get(row.id) ?? 0,
        };
      }),
      total,
      page,
      limit,
    });
  }

  async getAdmin(id: string) {
    const membership = await this.findMembership(id);
    const user = membership.userId
      ? await this.userRepo.findOne({ where: { id: membership.userId } })
      : null;
    const timeoutMinutes = await this.sessionTimeoutMinutes();
    const presence = await this.presenceMap([membership]);
    const actionCounts = await this.countActions(
      [membership.id],
      new Date(Date.now() - SEVEN_DAYS_MS),
    );
    const permissions = await this.enabledPermissionSummary(membership.role);
    const name = displayName(user, membership.email);

    return successResponse('Operation successful', {
      id: membership.id,
      userId: membership.userId,
      email: membership.email,
      displayName: name,
      initials: initials(name),
      profilePicture: user?.profilePicture ?? null,
      role: membership.role,
      roleLabel: roleLabel(membership.role),
      status: membership.status,
      presence: this.presenceFor(membership, presence, timeoutMinutes),
      lastActiveAt: membership.lastActiveAt,
      actions7d: actionCounts.get(membership.id) ?? 0,
      memberSince: membership.acceptedAt ?? membership.createdAt,
      twoFactorEnabled: membership.twoFactorEnabled,
      permissions,
    });
  }

  async invite(dto: InviteAdminDto, actor: AdminActor) {
    await this.assertCanAssignRole(actor, dto.role);
    const existing = await this.membershipRepo.findOne({
      where: {
        email: dto.email,
        status: In([
          AdminMembershipStatus.PENDING,
          AdminMembershipStatus.ACTIVE,
        ]),
      },
    });
    if (existing) {
      throw new ConflictException(
        'An admin invite or membership already exists for this email',
      );
    }

    const user = await this.userRepo.findOne({
      where: { email: ILike(dto.email) },
    });
    const actorMembership = await this.activeMembership(actor.id);
    const membership = await this.membershipRepo.save(
      this.membershipRepo.create({
        email: dto.email,
        userId: null,
        role: dto.role,
        status: AdminMembershipStatus.PENDING,
        invitedById: actor.id,
        invitedAt: new Date(),
        twoFactorEnabled: false,
      }),
    );

    await this.recordAudit({
      actorUserId: actor.id,
      actorMembershipId: actorMembership?.id ?? null,
      action: AdminAuditAction.INVITED,
      targetType: 'admin_membership',
      targetId: membership.id,
      metadata: { email: dto.email, role: dto.role },
    });

    if (user) {
      try {
        await this.notificationService.notifyUser({
          userId: user.id,
          title: 'Admin invite',
          body: 'You have been invited to the Bluebeep admin console.',
          sendPush: false,
        });
      } catch (error) {
        this.logger.warn(
          `Admin invite notification failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    const templateId = this.configService.get<string>(
      'ADMIN_INVITE_TEMPLATE_ID',
    );
    if (templateId) {
      try {
        await this.emailQueue.add(
          JobType.SEND_EMAIL_ZEPTO,
          {
            recipient: dto.email,
            subject: 'You have been invited to Bluebeep admin',
            templateId,
            templateVariables: { role: roleLabel(dto.role) },
          },
          {
            removeOnComplete: true,
            removeOnFail: false,
            attempts: 3,
            backoff: { type: 'exponential', delay: 3000 },
          },
        );
      } catch (error) {
        this.logger.warn(
          `Admin invite email failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }

    return successResponse(
      'Admin invited',
      {
        id: membership.id,
        email: membership.email,
        role: membership.role,
        status: membership.status,
      },
      HttpStatus.CREATED,
    );
  }

  async updateAdmin(id: string, dto: UpdateAdminDto, actor: AdminActor) {
    const membership = await this.findMembership(id);
    if (membership.status === AdminMembershipStatus.REVOKED) {
      throw new BadRequestException('Revoked admins cannot be edited');
    }
    if (!dto.role && !dto.email) {
      throw new BadRequestException('Nothing to update');
    }

    if (dto.role) {
      await this.assertCanAssignRole(actor, dto.role);
      await this.assertNotLastSuperAdminDemotion(membership, dto.role);
    }

    if (dto.email && dto.email !== membership.email) {
      if (membership.status !== AdminMembershipStatus.PENDING) {
        throw new BadRequestException(
          'Email can only be changed while the invite is pending',
        );
      }
      const duplicate = await this.membershipRepo.findOne({
        where: {
          email: dto.email,
          status: In([
            AdminMembershipStatus.PENDING,
            AdminMembershipStatus.ACTIVE,
          ]),
        },
      });
      if (duplicate && duplicate.id !== membership.id) {
        throw new ConflictException(
          'An admin invite or membership already exists for this email',
        );
      }
      membership.email = dto.email;
    }

    const previousRole = membership.role;
    if (dto.role && dto.role !== membership.role) {
      membership.role = dto.role;
      if (
        membership.status === AdminMembershipStatus.ACTIVE &&
        membership.userId
      ) {
        await this.userRepo.update(
          { id: membership.userId },
          { role: UserRoles.ADMIN },
        );
      }
    }

    await this.membershipRepo.save(membership);
    if (dto.role && dto.role !== previousRole) {
      const actorMembership = await this.activeMembership(actor.id);
      await this.recordAudit({
        actorUserId: actor.id,
        actorMembershipId: actorMembership?.id ?? null,
        action: AdminAuditAction.ROLE_CHANGED,
        targetType: 'admin_membership',
        targetId: membership.id,
        metadata: { from: previousRole, to: dto.role, email: membership.email },
      });
    }

    return this.getAdmin(id);
  }

  async revoke(id: string, actor: AdminActor) {
    const membership = await this.findMembership(id);
    if (membership.status === AdminMembershipStatus.REVOKED) {
      throw new BadRequestException('Access is already revoked');
    }
    if (membership.userId && membership.userId === actor.id) {
      throw new BadRequestException('You cannot revoke your own access');
    }
    if (
      membership.role === AdminDashboardRole.SUPER_ADMIN &&
      membership.status === AdminMembershipStatus.ACTIVE
    ) {
      const others = await this.membershipRepo.count({
        where: {
          role: AdminDashboardRole.SUPER_ADMIN,
          status: AdminMembershipStatus.ACTIVE,
          id: Not(membership.id),
        },
      });
      if (others < 1) {
        throw new BadRequestException('Cannot revoke the last super admin');
      }
    }

    membership.status = AdminMembershipStatus.REVOKED;
    membership.revokedAt = new Date();
    await this.membershipRepo.save(membership);
    if (membership.userId) {
      await this.userRepo.update(
        { id: membership.userId },
        { role: UserRoles.USER },
      );
    }

    const actorMembership = await this.activeMembership(actor.id);
    await this.recordAudit({
      actorUserId: actor.id,
      actorMembershipId: actorMembership?.id ?? null,
      action: AdminAuditAction.REVOKED,
      targetType: 'admin_membership',
      targetId: membership.id,
      metadata: { email: membership.email, role: membership.role },
    });

    return successResponse('Access revoked', {
      id: membership.id,
      status: membership.status,
    });
  }

  async acceptInvite(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.email) {
      throw new NotFoundException('User not found');
    }
    const email = user.email.trim().toLowerCase();
    const membership = await this.membershipRepo.findOne({
      where: { email, status: AdminMembershipStatus.PENDING },
    });
    if (!membership) {
      throw new NotFoundException('No pending admin invite for this account');
    }
    const already = await this.membershipRepo.findOne({
      where: { userId: user.id, status: AdminMembershipStatus.ACTIVE },
    });
    if (already) {
      throw new ConflictException('This account is already an active admin');
    }

    membership.userId = user.id;
    membership.email = email;
    membership.status = AdminMembershipStatus.ACTIVE;
    membership.acceptedAt = new Date();
    membership.lastActiveAt = new Date();
    await this.membershipRepo.save(membership);
    await this.userRepo.update({ id: user.id }, { role: UserRoles.ADMIN });
    await this.recordAudit({
      actorUserId: user.id,
      actorMembershipId: membership.id,
      action: AdminAuditAction.ACCEPTED,
      targetType: 'admin_membership',
      targetId: membership.id,
      metadata: { email, role: membership.role },
    });

    return successResponse('Invite accepted', {
      id: membership.id,
      role: membership.role,
      status: membership.status,
    });
  }

  async listRoles() {
    const counts = await this.membershipRepo
      .createQueryBuilder('m')
      .select('m.role', 'role')
      .addSelect('COUNT(*)', 'count')
      .where('m.status = :status', { status: AdminMembershipStatus.ACTIVE })
      .groupBy('m.role')
      .getRawMany<{ role: AdminDashboardRole; count: string }>();
    const countByRole = new Map(
      counts.map((row) => [row.role, Number(row.count)]),
    );

    return successResponse('Operation successful', {
      items: ADMIN_ROLE_META.map((meta) => ({
        role: meta.role,
        label: meta.label,
        description: meta.description,
        accent: meta.accent,
        memberCount: countByRole.get(meta.role) ?? 0,
      })),
    });
  }

  async getRolePermissions(role: AdminDashboardRole) {
    const catalog = await this.catalog();
    const grants = await this.rolePermRepo.find({ where: { role } });
    const enabledByKey = new Map(
      grants.map((grant) => [grant.permissionKey, grant.enabled]),
    );

    return successResponse('Operation successful', {
      role,
      roleLabel: roleLabel(role),
      groups: ADMIN_PERMISSION_GROUPS.map((group) => ({
        key: group.key,
        label: group.label,
        permissions: catalog
          .filter((permission) => permission.group === group.key)
          .map((permission) => ({
            key: permission.key,
            label: permission.label,
            description: permission.description,
            enabled:
              enabledByKey.get(permission.key) ??
              isDefaultEnabled(role, permission.key),
          })),
      })),
    });
  }

  async updateRolePermissions(
    role: AdminDashboardRole,
    grants: Record<string, boolean>,
    actor: AdminActor,
  ) {
    this.assertSuperAdminManageLock(role, grants);
    await this.saveGrants(role, grants);
    const actorMembership = await this.activeMembership(actor.id);
    await this.recordAudit({
      actorUserId: actor.id,
      actorMembershipId: actorMembership?.id ?? null,
      action: AdminAuditAction.PERMISSIONS_UPDATED,
      targetType: 'admin_role',
      targetId: role,
      metadata: { role },
    });
    return this.getRolePermissions(role);
  }

  async resetRolePermissions(role: AdminDashboardRole, actor: AdminActor) {
    const grants = Object.fromEntries(
      ADMIN_PERMISSIONS.map((permission) => [
        permission.key,
        isDefaultEnabled(role, permission.key),
      ]),
    );
    await this.saveGrants(role, grants);
    const actorMembership = await this.activeMembership(actor.id);
    await this.recordAudit({
      actorUserId: actor.id,
      actorMembershipId: actorMembership?.id ?? null,
      action: AdminAuditAction.PERMISSIONS_RESET,
      targetType: 'admin_role',
      targetId: role,
      metadata: { role },
    });
    return this.getRolePermissions(role);
  }

  async listAudit(query: AdminAuditQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const [items, total] = await this.auditRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return successResponse('Operation successful', {
      items,
      total,
      page,
      limit,
    });
  }

  private async saveGrants(
    role: AdminDashboardRole,
    grants: Record<string, boolean>,
  ) {
    const existing = await this.rolePermRepo.find({ where: { role } });
    const byKey = new Map(existing.map((row) => [row.permissionKey, row]));
    const rows = ADMIN_PERMISSIONS.map((permission) => {
      const row =
        byKey.get(permission.key) ??
        this.rolePermRepo.create({
          role,
          permissionKey: permission.key,
          enabled: false,
        });
      row.enabled = grants[permission.key];
      return row;
    });
    await this.rolePermRepo.save(rows);
  }

  private assertSuperAdminManageLock(
    role: AdminDashboardRole,
    grants: Record<string, boolean>,
  ) {
    if (
      role === AdminDashboardRole.SUPER_ADMIN &&
      grants[ADMINS_MANAGE_PERMISSION] !== true
    ) {
      throw new BadRequestException(
        'Super Admin must keep the manage admins permission',
      );
    }
  }

  private async assertCanAssignRole(
    actor: AdminActor,
    role: AdminDashboardRole,
  ) {
    if (role !== AdminDashboardRole.SUPER_ADMIN) return;
    const membership = await this.activeMembership(actor.id);
    const actorIsSuper = membership?.role === AdminDashboardRole.SUPER_ADMIN;
    if (!actorIsSuper) {
      throw new ForbiddenException(
        'Only a super admin can assign the super admin role',
      );
    }
  }

  private async assertNotLastSuperAdminDemotion(
    membership: AdminMembership,
    nextRole: AdminDashboardRole,
  ) {
    if (
      membership.role !== AdminDashboardRole.SUPER_ADMIN ||
      nextRole === AdminDashboardRole.SUPER_ADMIN ||
      membership.status !== AdminMembershipStatus.ACTIVE
    ) {
      return;
    }
    const others = await this.membershipRepo.count({
      where: {
        role: AdminDashboardRole.SUPER_ADMIN,
        status: AdminMembershipStatus.ACTIVE,
        id: Not(membership.id),
      },
    });
    if (others < 1) {
      throw new BadRequestException(
        'Cannot change the role of the last super admin',
      );
    }
  }

  private async findMembership(id: string) {
    const membership = await this.membershipRepo.findOne({ where: { id } });
    if (!membership) throw new NotFoundException('Admin not found');
    return membership;
  }

  private async activeMembership(userId: string) {
    return this.membershipRepo.findOne({
      where: { userId, status: AdminMembershipStatus.ACTIVE },
    });
  }

  private async catalog() {
    const stored = await this.permissionRepo.find({
      order: { sortOrder: 'ASC' },
    });
    if (stored.length) return stored;
    return ADMIN_PERMISSIONS;
  }

  private async enabledPermissionSummary(role: AdminDashboardRole) {
    const catalog = await this.catalog();
    const grants = await this.rolePermRepo.find({ where: { role } });
    const enabledByKey = new Map(
      grants.map((grant) => [grant.permissionKey, grant.enabled]),
    );
    return catalog
      .filter((permission) =>
        enabledByKey.has(permission.key)
          ? enabledByKey.get(permission.key)
          : isDefaultEnabled(role, permission.key),
      )
      .map((permission) => ({
        key: permission.key,
        label: permission.label,
      }));
  }

  private async loadUsers(ids: Array<string | null>) {
    const userIds = ids.filter((id): id is string => !!id);
    if (!userIds.length) return new Map<string, User>();
    const users = await this.userRepo.find({ where: { id: In(userIds) } });
    return new Map(users.map((user) => [user.id, user]));
  }

  private async countActions(membershipIds: string[], since: Date) {
    const counts = new Map<string, number>();
    if (!membershipIds.length) return counts;
    const rows = await this.auditRepo
      .createQueryBuilder('e')
      .select('e.actor_membership_id', 'membership_id')
      .addSelect('COUNT(*)', 'count')
      .where('e.actor_membership_id IN (:...ids)', { ids: membershipIds })
      .andWhere('e.created_at >= :since', { since })
      .groupBy('e.actor_membership_id')
      .getRawMany<{ membership_id: string; count: string }>();
    for (const row of rows) {
      counts.set(row.membership_id, Number(row.count));
    }
    return counts;
  }

  private async sessionTimeoutMinutes() {
    const settings = await this.settingsRepo.findOne({
      where: { id: PLATFORM_SETTINGS_ID },
    });
    return settings?.sessionTimeoutMinutes ?? 30;
  }

  private async presenceMap(rows: AdminMembership[]) {
    const flags = new Map<string, boolean>();
    await Promise.all(
      rows.map(async (row) => {
        if (!row.userId) return;
        flags.set(row.userId, await this.presenceService.isOnline(row.userId));
      }),
    );
    return flags;
  }

  private presenceFor(
    membership: AdminMembership,
    onlineByUser: Map<string, boolean>,
    timeoutMinutes: number,
  ): 'online' | 'away' | 'offline' | null {
    if (
      membership.status !== AdminMembershipStatus.ACTIVE ||
      !membership.userId
    ) {
      return null;
    }
    if (onlineByUser.get(membership.userId)) return 'online';
    if (membership.lastActiveAt) {
      const gap = Date.now() - new Date(membership.lastActiveAt).getTime();
      if (gap <= timeoutMinutes * 60 * 1000) return 'away';
    }
    return 'offline';
  }

  private async recordAudit(input: {
    actorUserId: string | null;
    actorMembershipId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.auditRepo.save(this.auditRepo.create(input));
  }
}
