import { BadRequestException, ConflictException } from '@nestjs/common';
import { AdminAccessService } from './admin-access.service';
import { ADMIN_PERMISSIONS } from './admin-permissions.catalog';
import { AdminDashboardRole } from './enums/admin-dashboard-role.enum';
import { AdminMembershipStatus } from './enums/admin-membership-status.enum';
import { UserRoles } from 'src/common/enums/user-roles.constants';

describe('AdminAccessService', () => {
  const membershipRepo = {
    findOne: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    count: jest.fn(),
  };
  const permissionRepo = { find: jest.fn() };
  const rolePermRepo = {
    find: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(),
  };
  const auditRepo = {
    create: jest.fn((value) => value),
    save: jest.fn(),
  };
  const userRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const settingsRepo = { findOne: jest.fn() };
  const notificationService = { notifyUser: jest.fn() };
  const presenceService = { isOnline: jest.fn() };
  const configService = { get: jest.fn() };
  const emailQueue = { add: jest.fn() };

  const service = new AdminAccessService(
    membershipRepo as any,
    permissionRepo as any,
    rolePermRepo as any,
    auditRepo as any,
    userRepo as any,
    settingsRepo as any,
    notificationService as any,
    presenceService as any,
    configService as any,
    emailQueue as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a duplicate pending or active invite', async () => {
    membershipRepo.findOne.mockResolvedValue({ id: 'existing' });

    await expect(
      service.invite(
        { email: 'ayaan@bluebeep.com', role: AdminDashboardRole.ADMIN },
        { id: 'actor', role: UserRoles.SUPER_ADMIN },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(membershipRepo.save).not.toHaveBeenCalled();
  });

  it('links the user and syncs users.role when an invite is accepted', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'Ayaan@Bluebeep.com',
    });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        id: 'membership-1',
        email: 'ayaan@bluebeep.com',
        role: AdminDashboardRole.SENIOR_ADMIN,
        status: AdminMembershipStatus.PENDING,
      })
      .mockResolvedValueOnce(null);

    await service.acceptInvite('user-1');

    expect(membershipRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        email: 'ayaan@bluebeep.com',
        status: AdminMembershipStatus.ACTIVE,
        role: AdminDashboardRole.SENIOR_ADMIN,
      }),
    );
    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      { role: UserRoles.ADMIN },
    );
  });

  it('stores admin on the user when a super admin invite is accepted', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      email: 'admin@bluebeep.com',
    });
    membershipRepo.findOne
      .mockResolvedValueOnce({
        id: 'membership-1',
        email: 'admin@bluebeep.com',
        role: AdminDashboardRole.SUPER_ADMIN,
        status: AdminMembershipStatus.PENDING,
      })
      .mockResolvedValueOnce(null);

    await service.acceptInvite('user-1');

    expect(userRepo.update).toHaveBeenCalledWith(
      { id: 'user-1' },
      { role: UserRoles.ADMIN },
    );
  });

  it('refuses to revoke the last active super admin', async () => {
    membershipRepo.findOne.mockResolvedValue({
      id: 'membership-1',
      userId: 'other-user',
      role: AdminDashboardRole.SUPER_ADMIN,
      status: AdminMembershipStatus.ACTIVE,
      email: 'admin@bluebeep.com',
    });
    membershipRepo.count.mockResolvedValue(0);

    await expect(
      service.revoke('membership-1', { id: 'actor' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(membershipRepo.save).not.toHaveBeenCalled();
  });

  it('refuses to turn off manage-admins for super admin', async () => {
    const grants = Object.fromEntries(
      ADMIN_PERMISSIONS.map((permission) => [permission.key, true]),
    );
    grants['admins.manage'] = false;

    await expect(
      service.updateRolePermissions(AdminDashboardRole.SUPER_ADMIN, grants, {
        id: 'actor',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(rolePermRepo.save).not.toHaveBeenCalled();
  });
});
