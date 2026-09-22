// src/seeder/seeder.service.ts
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { User } from 'src/modules/user/entity/user.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcryptjs';
import { UserRoles } from 'src/common/enums/user-roles.constants';
import {
  ADMIN_PERMISSIONS,
  isDefaultEnabled,
} from 'src/modules/admin/access/admin-permissions.catalog';
import { AdminMembership } from 'src/modules/admin/access/entities/admin-membership.entity';
import { AdminPermission } from 'src/modules/admin/access/entities/admin-permission.entity';
import { AdminRolePermission } from 'src/modules/admin/access/entities/admin-role-permission.entity';
import { PlatformSettings } from 'src/modules/admin/access/entities/platform-settings.entity';
import { AdminDashboardRole } from 'src/modules/admin/access/enums/admin-dashboard-role.enum';
import { AdminMembershipStatus } from 'src/modules/admin/access/enums/admin-membership-status.enum';
import { DEFAULT_PLATFORM_SETTINGS } from 'src/modules/admin/access/platform-settings.defaults';

@Injectable()
export class SeederService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private configService: ConfigService,
    private dataSource: DataSource,
  ) {}

  private get superAdminUser() {
    return {
      email: this.configService.get('ADMIN_EMAIL'),
      password: this.configService.get('ADMIN_PASSWORD'),
    };
  }

  async onApplicationBootstrap() {
    try {
      await this.seed();
    } catch (error) {
      console.error(
        'Seeding failed. Application will not start:',
        error.message,
      );
      process.exit(1);
    }
  }

  async superAdminSeed(entityManager: EntityManager): Promise<User> {
    const userRepo = entityManager.getRepository(User);
    const { email, password } = this.superAdminUser;
    const normalizedEmail = email?.trim().toLowerCase();

    let user = normalizedEmail
      ? await userRepo
          .createQueryBuilder('u')
          .where('LOWER(u.email) = :email', { email: normalizedEmail })
          .getOne()
      : null;

    if (!user) {
      user = await userRepo.findOne({
        where: { role: UserRoles.SUPER_ADMIN },
      });
    }

    if (!user) {
      if (!normalizedEmail || !password) {
        throw new Error('No credentials set for super admin');
      }
      const hashedPassword = await hash(password, 10);
      user = await userRepo.save(
        userRepo.create({
          firstName: 'Admin',
          lastName: 'Bluebeep',
          email: normalizedEmail,
          password: hashedPassword,
          role: UserRoles.ADMIN,
          verified: true,
          username: 'admin',
        }),
      );
    }

    return user;
  }

  async adminAccessSeed(entityManager: EntityManager, bootstrap?: User) {
    const table = await entityManager.query(
      `SELECT to_regclass('public.admin_memberships') AS reg`,
    );
    if (!table?.[0]?.reg) {
      console.warn(
        'Skipping admin access seed; run the admin-access migration first.',
      );
      return;
    }

    const permissionRepo = entityManager.getRepository(AdminPermission);
    await permissionRepo.upsert(
      ADMIN_PERMISSIONS.map((permission) => ({
        key: permission.key,
        group: permission.group,
        label: permission.label,
        description: permission.description,
        sortOrder: permission.sortOrder,
      })),
      ['key'],
    );

    const rolePermRepo = entityManager.getRepository(AdminRolePermission);
    const existingGrants = await rolePermRepo.find();
    const have = new Set(
      existingGrants.map((grant) => `${grant.role}:${grant.permissionKey}`),
    );
    const missing: AdminRolePermission[] = [];
    for (const role of Object.values(AdminDashboardRole)) {
      for (const permission of ADMIN_PERMISSIONS) {
        const id = `${role}:${permission.key}`;
        if (have.has(id)) continue;
        missing.push(
          rolePermRepo.create({
            role,
            permissionKey: permission.key,
            enabled: isDefaultEnabled(role, permission.key),
          }),
        );
      }
    }
    if (missing.length) await rolePermRepo.save(missing);

    const settingsRepo = entityManager.getRepository(PlatformSettings);
    const settings = await settingsRepo.findOne({
      where: { id: DEFAULT_PLATFORM_SETTINGS.id },
    });
    if (!settings) {
      await settingsRepo.save(settingsRepo.create(DEFAULT_PLATFORM_SETTINGS));
    }

    const userRepo = entityManager.getRepository(User);
    const legacySuperAdmins = await userRepo.find({
      where: { role: UserRoles.SUPER_ADMIN },
    });
    const staff = new Map<string, User>();
    if (bootstrap?.id) staff.set(bootstrap.id, bootstrap);
    for (const user of legacySuperAdmins) staff.set(user.id, user);

    for (const user of staff.values()) {
      if (!user.email) continue;
      await this.ensureSuperAdminMembership(entityManager, user);
      if (user.role === UserRoles.SUPER_ADMIN) {
        await userRepo.update({ id: user.id }, { role: UserRoles.ADMIN });
      }
    }
  }

  private async ensureSuperAdminMembership(
    entityManager: EntityManager,
    user: User,
  ) {
    const email = user.email.trim().toLowerCase();
    const membershipRepo = entityManager.getRepository(AdminMembership);
    const open = await membershipRepo.findOne({
      where: [
        { userId: user.id, status: AdminMembershipStatus.ACTIVE },
        { email, status: AdminMembershipStatus.ACTIVE },
        { email, status: AdminMembershipStatus.PENDING },
      ],
    });
    if (open) {
      if (
        open.status !== AdminMembershipStatus.ACTIVE ||
        open.userId !== user.id ||
        open.role !== AdminDashboardRole.SUPER_ADMIN
      ) {
        open.userId = user.id;
        open.email = email;
        open.role = AdminDashboardRole.SUPER_ADMIN;
        open.status = AdminMembershipStatus.ACTIVE;
        open.acceptedAt = open.acceptedAt ?? new Date();
        await membershipRepo.save(open);
      }
      return;
    }

    await membershipRepo.save(
      membershipRepo.create({
        email,
        userId: user.id,
        role: AdminDashboardRole.SUPER_ADMIN,
        status: AdminMembershipStatus.ACTIVE,
        acceptedAt: new Date(),
        lastActiveAt: new Date(),
        twoFactorEnabled: false,
      }),
    );
  }

  async seed() {
    try {
      await this.dataSource.manager.transaction(async (entityManager) => {
        const bootstrap = await this.superAdminSeed(entityManager);
        await this.adminAccessSeed(entityManager, bootstrap);
      });
    } catch (error) {
      throw error;
    }
  }
}
