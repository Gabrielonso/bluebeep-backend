import { ExecutionContext, HttpException } from '@nestjs/common';
import { AdminMembershipGuard } from './admin-membership.guard';
import { AdminDashboardRole } from '../enums/admin-dashboard-role.enum';
import { AdminMembershipStatus } from '../enums/admin-membership-status.enum';

describe('AdminMembershipGuard', () => {
  const membershipRepo = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const settingsRepo = {
    findOne: jest.fn(),
  };
  const guard = new AdminMembershipGuard(
    membershipRepo as any,
    settingsRepo as any,
  );

  const contextFor = (method: string) => {
    const req = {
      method,
      headers: {},
      user: { id: 'user-1', role: 'admin' },
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as ExecutionContext;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    settingsRepo.findOne.mockResolvedValue({
      sessionTimeoutMinutes: 30,
      ipAllowlistEnabled: false,
      ipAllowlist: [],
    });
    membershipRepo.findOne.mockResolvedValue({
      id: 'membership-1',
      userId: 'user-1',
      role: AdminDashboardRole.READ_ONLY,
      status: AdminMembershipStatus.ACTIVE,
      lastActiveAt: new Date(),
    });
  });

  it('rejects mutations from a read-only admin', async () => {
    await expect(guard.canActivate(contextFor('POST'))).rejects.toBeInstanceOf(
      HttpException,
    );
    try {
      await guard.canActivate(contextFor('POST'));
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(403);
    }
    expect(membershipRepo.update).not.toHaveBeenCalled();
  });

  it('allows reads from a read-only admin', async () => {
    await expect(guard.canActivate(contextFor('GET'))).resolves.toBe(true);
    expect(membershipRepo.update).toHaveBeenCalled();
  });
});
